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
		readback, rErr := cred.ReadClientCredential()
		if rErr != nil || readback == nil || readback.Token.RefreshToken != payload.Token.RefreshToken {
			return nil, errors.New("凭据写入后回读校验失败")
		}
		return &SwitchResult{
			Success: true,
			Message: "凭据已更新",
		}, nil
	}

	version := DetectClientVersion(clientPath)
	isModern := IsModernVersion(version)

	// Check legacy SQLite DB candidates
	appData := os.Getenv("APPDATA")
	candidates := FindCandidateLegacyDBPaths(appData, clientPath)
	var legacyDBPath string
	for _, cp := range candidates {
		if _, err := os.Stat(cp); err == nil {
			legacyDBPath = cp
			break
		}
	}

	// Requirement: 版本未知时，只有验证了旧版数据库结构才允许写入
	if version == "" && legacyDBPath != "" {
		if err := cs.dbSync.ValidateDBSchema(legacyDBPath); err == nil {
			return cs.switchLegacy(payload, clientPath, legacyDBPath)
		}
	} else if !isModern && legacyDBPath != "" {
		if err := cs.dbSync.ValidateDBSchema(legacyDBPath); err == nil {
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
			// Hot switch attempt: kill language_server subprocesses
			for _, pid := range lsPIDs {
				_ = KillPID(pid)
			}

			// Best-effort post-kill re-assert write
			_ = cred.WriteClientCredential(payload)

			// Wait for respawn
			if WaitForLanguageServerRespawn(runningProc.PID, 15*time.Second) {
				// Verify readback
				readback, err := cred.ReadClientCredential()
				if err != nil || readback == nil || readback.Token.RefreshToken != payload.Token.RefreshToken {
					return nil, errors.New("凭据写入后回读校验失败")
				}
				return &SwitchResult{
					Success:     true,
					HotSwitched: true,
					Message:     "凭据已更新",
				}, nil
			}
		}

		// Hot switch degraded or not possible: full restart
		// Capture command line args before killing
		cmdLine := GetProcessCommandLine(runningProc.PID)
		activeArgs := ParseCommandLineArgs(cmdLine)

		_ = KillProcessTree(runningProc.PID)
		_ = WaitForProcessExit(runningProc.PID, 10*time.Second)

		// Sweep orphan language_server processes
		SweepOrphanLanguageServers()

		// Post-kill re-assert write
		_ = cred.WriteClientCredential(payload)

		// Relaunch with captured args
		_ = LaunchClient(clientPath, activeArgs...)

		// Verify readback
		readback, err := cred.ReadClientCredential()
		if err != nil || readback == nil || readback.Token.RefreshToken != payload.Token.RefreshToken {
			return nil, errors.New("凭据写入后回读校验失败")
		}

		return &SwitchResult{
			Success:          true,
			ClientRelaunched: true,
			Message:          "凭据已更新",
		}, nil
	}

	// Client was not running: write credential and launch
	if err := cred.WriteClientCredential(payload); err != nil {
		return nil, fmt.Errorf("failed to write system keyring: %w", err)
	}

	SweepOrphanLanguageServers()
	_ = LaunchClient(clientPath)

	// Verify readback
	readback, err := cred.ReadClientCredential()
	if err != nil || readback == nil || readback.Token.RefreshToken != payload.Token.RefreshToken {
		return nil, errors.New("凭据写入后回读校验失败")
	}

	return &SwitchResult{
		Success:          true,
		ClientRelaunched: true,
		Message:          "凭据已更新",
	}, nil
}

func (cs *ClientSwitcher) switchLegacy(payload *cred.CredentialPayload, clientPath, dbPath string) (*SwitchResult, error) {
	// Close running client if any (graceful close + timeout check)
	var activeArgs []string
	runningProc, err := FindRunningAntigravityMain()
	if err == nil && runningProc != nil {
		cmdLine := GetProcessCommandLine(runningProc.PID)
		activeArgs = ParseCommandLineArgs(cmdLine)

		// Attempt graceful close without /F
		_ = ClosePIDGraceful(runningProc.PID)

		// Wait up to 15s for normal exit
		if !WaitForProcessExit(runningProc.PID, 15*time.Second) {
			return nil, errors.New("旧版客户端正常关闭超时，请先手动关闭 Antigravity 客户端后再切换")
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

	// Verify readback from legacy database
	_, readbackRT, _, _, err := cs.dbSync.ReadLegacyToken(dbPath)
	if err != nil || readbackRT != payload.Token.RefreshToken {
		return nil, errors.New("旧版数据库写入后回读校验失败")
	}

	if clientPath != "" {
		_ = LaunchClient(clientPath, activeArgs...)
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
