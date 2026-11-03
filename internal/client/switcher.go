package client

import (
	"errors"
	"fmt"
	"os"
	"time"

	"codetool/internal/cred"
)

// SwitchResult contains the outcome of an account switch.
type SwitchResult struct {
	Success          bool   `json:"success"`
	HotSwitched      bool   `json:"hotSwitched"`
	ClientRelaunched bool   `json:"clientRelaunched"`
	Message          string `json:"message"`
}

// ClientSwitcher manages switching the active account in the Antigravity client.
type ClientSwitcher struct {
	dbSync *LegacyDBSync
}

// NewClientSwitcher creates a new ClientSwitcher instance.
func NewClientSwitcher() *ClientSwitcher {
	return &ClientSwitcher{
		dbSync: &LegacyDBSync{},
	}
}

// SwitchAccount executes account switching according to client version and runtime status.
func (cs *ClientSwitcher) SwitchAccount(payload *cred.CredentialPayload, clientOverridePath string) (*SwitchResult, error) {
	if payload == nil {
		return nil, errors.New("cannot switch: nil credential payload")
	}

	clientPath, err := DetectClientPath(clientOverridePath)
	if err != nil {
		// Even if client path cannot be detected, write credential anyway if it's modern
		_ = cred.WriteClientCredential(payload)
		return &SwitchResult{
			Success: true,
			Message: "凭据已更新（未检测到客户端运行或可执行文件）",
		}, nil
	}

	version := DetectClientVersion(clientPath)
	isModern := IsModernVersion(version)

	// Check if legacy DB exists if version is unknown
	if !isModern || version == "" {
		appData := os.Getenv("APPDATA")
		candidates := FindCandidateLegacyDBPaths(appData, clientPath)
		var legacyDBPath string
		for _, cp := range candidates {
			if _, err := os.Stat(cp); err == nil {
				legacyDBPath = cp
				break
			}
		}

		if legacyDBPath != "" && !isModern {
			return cs.switchLegacy(payload, clientPath, legacyDBPath)
		}
	}

	// Modern switch path (>= 2.0.0 or default)
	return cs.switchModern(payload, clientPath)
}

func (cs *ClientSwitcher) switchModern(payload *cred.CredentialPayload, clientPath string) (*SwitchResult, error) {
	runningProc, err := FindRunningAntigravityMain()
	isRunning := (err == nil && runningProc != nil)

	if isRunning {
		// 1. Pre-kill credential write
		if err := cred.WriteClientCredential(payload); err != nil {
			return nil, fmt.Errorf("failed to write system keyring: %w", err)
		}

		// 2. Locate language_server subprocesses
		lsPIDs, err := FindLanguageServerDescendants(runningProc.PID)
		if err == nil && len(lsPIDs) > 0 {
			// Hot switch attempt
			for _, pid := range lsPIDs {
				_ = KillPID(pid)
			}

			// Best-effort post-kill re-assert write
			_ = cred.WriteClientCredential(payload)

			// Wait for respawn
			if WaitForLanguageServerRespawn(runningProc.PID, 15*time.Second) {
				return &SwitchResult{
					Success:     true,
					HotSwitched: true,
					Message:     "凭据已更新（热切换成功）",
				}, nil
			}
		}

		// Hot switch degraded or not possible: full restart
		_ = KillProcessTree(runningProc.PID)
		// Wait for process to exit
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			time.Sleep(300 * time.Millisecond)
			if check, _ := FindRunningAntigravityMain(); check == nil {
				break
			}
		}

		// Post-kill re-assert write
		_ = cred.WriteClientCredential(payload)

		// Relaunch
		_ = LaunchClient(clientPath)

		return &SwitchResult{
			Success:          true,
			ClientRelaunched: true,
			Message:          "凭据已更新（客户端已重启）",
		}, nil
	}

	// Client was not running: write credential and launch
	if err := cred.WriteClientCredential(payload); err != nil {
		return nil, fmt.Errorf("failed to write system keyring: %w", err)
	}

	_ = LaunchClient(clientPath)

	return &SwitchResult{
		Success:          true,
		ClientRelaunched: true,
		Message:          "凭据已更新",
	}, nil
}

func (cs *ClientSwitcher) switchLegacy(payload *cred.CredentialPayload, clientPath, dbPath string) (*SwitchResult, error) {
	// Close running client if any
	runningProc, err := FindRunningAntigravityMain()
	if err == nil && runningProc != nil {
		_ = KillProcessTree(runningProc.PID)
		deadline := time.Now().Add(20 * time.Second)
		closed := false
		for time.Now().Before(deadline) {
			time.Sleep(500 * time.Millisecond)
			if check, _ := FindRunningAntigravityMain(); check == nil {
				closed = true
				break
			}
		}
		if !closed {
			return nil, errors.New("旧版客户端正在运行且无法自动关闭，请先手动退出 Antigravity 后再切换")
		}
	}

	expiryTime := payload.ParseExpiry()
	expirySecs := expiryTime.Unix()
	if expirySecs <= 0 {
		expirySecs = time.Now().Add(1 * time.Hour).Unix()
	}

	err = cs.dbSync.InjectLegacyToken(
		dbPath,
		payload.Token.AccessToken,
		payload.Token.RefreshToken,
		expirySecs,
		payload.IDTokenEmail,
		false,
	)
	if err != nil {
		return nil, fmt.Errorf("旧版数据库写入失败: %w", err)
	}

	if clientPath != "" {
		_ = LaunchClient(clientPath)
	}

	return &SwitchResult{
		Success:          true,
		ClientRelaunched: true,
		Message:          "凭据已更新",
	}, nil
}

// ReadCurrentClientCredential extracts the current logged-in credential from the client.
func (cs *ClientSwitcher) ReadCurrentClientCredential(clientOverridePath string) (*cred.CredentialPayload, error) {
	// 1. Try modern credential first
	c, err := cred.ReadClientCredential()
	if err == nil && c != nil && c.Token.RefreshToken != "" {
		return c, nil
	}

	// 2. Try legacy SQLite DB
	clientPath, _ := DetectClientPath(clientOverridePath)
	appData := os.Getenv("APPDATA")
	candidates := FindCandidateLegacyDBPaths(appData, clientPath)

	for _, cp := range candidates {
		if _, err := os.Stat(cp); err == nil {
			at, rt, exp, email, err := cs.dbSync.ReadLegacyToken(cp)
			if err == nil && rt != "" {
				return &cred.CredentialPayload{
					Token: cred.TokenInfo{
						AccessToken:  at,
						TokenType:    "Bearer",
						RefreshToken: rt,
						Expiry:       time.Unix(exp, 0).UTC().Format(time.RFC3339Nano),
						ExpiresIn:    3600,
					},
					AuthMethod:   "consumer",
					IDTokenEmail: email,
				}, nil
			}
		}
	}

	if c != nil {
		return c, nil
	}
	return nil, errors.New("未检测到当前客户端登录凭据")
}
