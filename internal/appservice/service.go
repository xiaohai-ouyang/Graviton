package appservice

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"codetool/internal/client"
	"codetool/internal/cred"
	"codetool/internal/oauth"
	"codetool/internal/quota"
	"codetool/internal/storage"

	"github.com/google/uuid"
)

// AppError represents a structured error returned to the frontend.
type AppError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *AppError) Error() string {
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

func NewAppError(code, message string) *AppError {
	return &AppError{Code: code, Message: message}
}

// AccountDisplay is the frontend projection of an account (credentials are NEVER included).
type AccountDisplay struct {
	ID                  string                `json:"id"`
	Email               string                `json:"email"`
	Name                string                `json:"name"`
	IsCurrent           bool                  `json:"isCurrent"`
	SubscriptionTier    string                `json:"subscriptionTier"`
	RemainingPercentage int                   `json:"remainingPercentage"`
	ResetTime           string                `json:"resetTime"`
	LastRefreshedAt     string                `json:"lastRefreshedAt"`
	LastSwitchedAt      string                `json:"lastSwitchedAt"`
	CreatedAt           string                `json:"createdAt"`
	Groups              []storage.QuotaGroup  `json:"groups"`
	Models              []storage.ModelQuota  `json:"models"`
	IsForbidden         bool                  `json:"isForbidden"`
	ErrorMessage        string                `json:"errorMessage"`
}

// BatchRefreshResult represents the result for a single account in a batch refresh.
type BatchRefreshResult struct {
	AccountID    string         `json:"accountId"`
	Success      bool           `json:"success"`
	ErrorMessage string         `json:"errorMessage,omitempty"`
	Account      AccountDisplay `json:"account"`
}

// AppService coordinates persistence, credentials, oauth, quota, and switching.
type AppService struct {
	storageMgr   *storage.StorageManager
	oauthSvc     *oauth.OAuthService
	quotaSvc     *quota.QuotaService
	switcher     *client.ClientSwitcher
	opLock       sync.Mutex
	httpClient   *http.Client
}

// NewAppService creates an AppService with custom or default dependencies.
func NewAppService(sm *storage.StorageManager, httpClient *http.Client) *AppService {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &AppService{
		storageMgr: sm,
		oauthSvc:   oauth.NewOAuthService(httpClient),
		quotaSvc:   quota.NewQuotaService(httpClient),
		switcher:   client.NewClientSwitcher(),
		httpClient: httpClient,
	}
}

// TryAcquireLock attempts to acquire the operation lock or returns BUSY error.
func (s *AppService) tryLock() (*sync.Mutex, error) {
	if !s.opLock.TryLock() {
		return nil, NewAppError("BUSY", "系统正在处理其他操作，请稍候")
	}
	return &s.opLock, nil
}

// toDisplay converts an AccountRecord to AccountDisplay.
func toDisplay(r storage.AccountRecord, isCurrent bool) AccountDisplay {
	return AccountDisplay{
		ID:                  r.ID,
		Email:               r.Email,
		Name:                r.Name,
		IsCurrent:           isCurrent,
		SubscriptionTier:    r.Quota.SubscriptionTier,
		RemainingPercentage: r.Quota.RemainingPercentage,
		ResetTime:           r.Quota.ResetTime,
		LastRefreshedAt:     r.Quota.LastRefreshedAt,
		LastSwitchedAt:      r.LastSwitchedAt,
		CreatedAt:           r.CreatedAt,
		Groups:              r.Quota.Groups,
		Models:              r.Quota.Models,
		IsForbidden:         r.Quota.IsForbidden,
		ErrorMessage:        r.Quota.ErrorMessage,
	}
}

// ListAccounts loads accounts from disk and flags the currently active client account.
func (s *AppService) ListAccounts() ([]AccountDisplay, error) {
	accounts, report, err := s.storageMgr.LoadAccounts()
	if err != nil {
		return nil, NewAppError("LOAD_FAILED", fmt.Sprintf("读取账号配置失败: %v", err))
	}

	settings, _, _ := s.storageMgr.LoadSettings()
	clientPath := ""
	if settings != nil {
		clientPath = settings.ClientPath
	}

	// Try reading active client credential to determine current account
	var currentEmail string
	if credPayload, err := s.switcher.ReadCurrentClientCredential(clientPath); err == nil && credPayload != nil {
		currentEmail = strings.ToLower(strings.TrimSpace(credPayload.IDTokenEmail))
	}

	result := make([]AccountDisplay, 0, len(accounts))
	for _, acc := range accounts {
		isCurrent := (currentEmail != "" && strings.ToLower(strings.TrimSpace(acc.Email)) == currentEmail)
		disp := toDisplay(acc, isCurrent)
		if report != "" && disp.ErrorMessage == "" {
			disp.ErrorMessage = report
		}
		result = append(result, disp)
	}

	return result, nil
}

// CaptureCurrentAccount captures the client's currently logged in account.
func (s *AppService) CaptureCurrentAccount() (*AccountDisplay, error) {
	lock, err := s.tryLock()
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	settings, _, _ := s.storageMgr.LoadSettings()
	clientPath := ""
	if settings != nil {
		clientPath = settings.ClientPath
	}

	// 1. Extract current client credentials
	credPayload, err := s.switcher.ReadCurrentClientCredential(clientPath)
	if err != nil || credPayload == nil || credPayload.Token.RefreshToken == "" {
		return nil, NewAppError("NO_CLIENT_ACCOUNT", "未检测到本机已登录的 Antigravity 账号，请在客户端登录后重试")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// 2. Ensure fresh access token before calling userinfo
	refreshed, _, err := s.oauthSvc.EnsureFreshToken(ctx, credPayload, false)
	if err != nil {
		if errors.Is(err, oauth.ErrInvalidGrant) {
			return nil, NewAppError("INVALID_GRANT", "当前账号登录已失效，请在客户端重新登录后收录")
		}
		return nil, NewAppError("REFRESH_FAILED", fmt.Sprintf("刷新 Token 失败: %v", err))
	}
	credPayload = refreshed

	// 3. Confirm identity via Google UserInfo
	userInfo, err := s.oauthSvc.FetchUserInfo(ctx, credPayload.Token.AccessToken)
	if err != nil {
		return nil, NewAppError("USERINFO_FAILED", fmt.Sprintf("确认账号身份失败: %v", err))
	}

	confirmedEmail := strings.TrimSpace(userInfo.Email)
	displayName := userInfo.GetDisplayName()
	credPayload.IDTokenEmail = confirmedEmail

	// 4. Load existing accounts to deduplicate by email
	accounts, _, err := s.storageMgr.LoadAccounts()
	if err != nil {
		return nil, NewAppError("STORAGE_ERROR", fmt.Sprintf("加载本地账号失败: %v", err))
	}

	var accountID string
	var existingIndex = -1
	for idx, acc := range accounts {
		if strings.EqualFold(strings.TrimSpace(acc.Email), confirmedEmail) {
			accountID = acc.ID
			existingIndex = idx
			break
		}
	}

	isNew := false
	if accountID == "" {
		accountID = uuid.New().String()
		isNew = true
	}

	// 5. Save independent credential first
	if err := cred.WriteAccountCredential(accountID, credPayload); err != nil {
		return nil, NewAppError("CRED_ERROR", fmt.Sprintf("保存凭据失败: %v", err))
	}

	// 6. Fetch quota snapshot
	var lastSnap *storage.QuotaSnapshot
	if existingIndex >= 0 {
		lastSnap = &accounts[existingIndex].Quota
	}

	quotaSnap, quotaErr := s.quotaSvc.FetchCompleteQuota(ctx, credPayload.Token.AccessToken, lastSnap)
	if quotaErr != nil {
		if errors.Is(quotaErr, quota.ErrUnauthorized) {
			// Retry once with force refresh
			if forceRefreshed, _, rErr := s.oauthSvc.EnsureFreshToken(ctx, credPayload, true); rErr == nil {
				credPayload = forceRefreshed
				_ = cred.WriteAccountCredential(accountID, credPayload)
				quotaSnap, _ = s.quotaSvc.FetchCompleteQuota(ctx, credPayload.Token.AccessToken, lastSnap)
			}
		}
	}

	nowStr := time.Now().UTC().Format(time.RFC3339)
	record := storage.AccountRecord{
		ID:        accountID,
		Email:     confirmedEmail,
		Name:      displayName,
		CreatedAt: nowStr,
		Quota:     quotaSnap,
	}

	if existingIndex >= 0 {
		record.CreatedAt = accounts[existingIndex].CreatedAt
		record.LastSwitchedAt = accounts[existingIndex].LastSwitchedAt
		accounts[existingIndex] = record
	} else {
		accounts = append(accounts, record)
	}

	// 7. Atomic commit to accounts.toml
	if err := s.storageMgr.SaveAccounts(accounts); err != nil {
		// Rollback credential if new
		if isNew {
			_ = cred.DeleteAccountCredential(accountID)
		}
		return nil, NewAppError("SAVE_FAILED", fmt.Sprintf("保存账号数据失败: %v", err))
	}

	disp := toDisplay(record, true)
	return &disp, nil
}

// RefreshAccountQuota updates the quota for a single account.
func (s *AppService) RefreshAccountQuota(id string) (*AccountDisplay, error) {
	lock, err := s.tryLock()
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	accounts, _, err := s.storageMgr.LoadAccounts()
	if err != nil {
		return nil, NewAppError("STORAGE_ERROR", fmt.Sprintf("加载本地账号失败: %v", err))
	}

	var targetIndex = -1
	for idx, acc := range accounts {
		if acc.ID == id {
			targetIndex = idx
			break
		}
	}
	if targetIndex < 0 {
		return nil, NewAppError("NOT_FOUND", "未找到指定账号")
	}

	// Read credential
	credPayload, err := cred.ReadAccountCredential(id)
	if err != nil {
		return nil, NewAppError("CRED_NOT_FOUND", "账号凭据丢失，请重新收录该账号")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Ensure token is fresh
	refreshed, tokenUpdated, err := s.oauthSvc.EnsureFreshToken(ctx, credPayload, false)
	if err != nil {
		if errors.Is(err, oauth.ErrInvalidGrant) {
			accounts[targetIndex].Quota.ErrorMessage = "登录已失效 (invalid_grant)，请在客户端重新登录后重新收录"
			_ = s.storageMgr.SaveAccounts(accounts)
			disp := toDisplay(accounts[targetIndex], false)
			return &disp, nil
		}
		return nil, NewAppError("REFRESH_FAILED", fmt.Sprintf("刷新 Token 失败: %v", err))
	}
	if tokenUpdated {
		credPayload = refreshed
		_ = cred.WriteAccountCredential(id, credPayload)
	}

	// Fetch quota
	lastSnap := &accounts[targetIndex].Quota
	quotaSnap, quotaErr := s.quotaSvc.FetchCompleteQuota(ctx, credPayload.Token.AccessToken, lastSnap)
	if quotaErr != nil && errors.Is(quotaErr, quota.ErrUnauthorized) {
		// Force refresh once
		if forceRefreshed, _, rErr := s.oauthSvc.EnsureFreshToken(ctx, credPayload, true); rErr == nil {
			credPayload = forceRefreshed
			_ = cred.WriteAccountCredential(id, credPayload)
			quotaSnap, _ = s.quotaSvc.FetchCompleteQuota(ctx, credPayload.Token.AccessToken, lastSnap)
		}
	}

	accounts[targetIndex].Quota = quotaSnap
	_ = s.storageMgr.SaveAccounts(accounts)

	disp := toDisplay(accounts[targetIndex], false)
	return &disp, nil
}

// RefreshAllQuotas updates quotas for all accounts with up to 5 concurrent workers.
func (s *AppService) RefreshAllQuotas() ([]BatchRefreshResult, error) {
	lock, err := s.tryLock()
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	accounts, _, err := s.storageMgr.LoadAccounts()
	if err != nil {
		return nil, NewAppError("STORAGE_ERROR", fmt.Sprintf("加载本地账号失败: %v", err))
	}

	if len(accounts) == 0 {
		return []BatchRefreshResult{}, nil
	}

	results := make([]BatchRefreshResult, len(accounts))
	sem := make(chan struct{}, 5)
	var wg sync.WaitGroup

	for i, acc := range accounts {
		wg.Add(1)
		go func(idx int, a storage.AccountRecord) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			res := BatchRefreshResult{
				AccountID: a.ID,
			}

			credPayload, err := cred.ReadAccountCredential(a.ID)
			if err != nil {
				res.Success = false
				res.ErrorMessage = "账号凭据丢失"
				res.Account = toDisplay(a, false)
				results[idx] = res
				return
			}

			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()

			refreshed, tokenUpdated, err := s.oauthSvc.EnsureFreshToken(ctx, credPayload, false)
			if err != nil {
				res.Success = false
				if errors.Is(err, oauth.ErrInvalidGrant) {
					res.ErrorMessage = "登录已失效 (invalid_grant)，请在客户端重新登录后重新收录"
				} else {
					res.ErrorMessage = fmt.Sprintf("Token 刷新失败: %v", err)
				}
				a.Quota.ErrorMessage = res.ErrorMessage
				res.Account = toDisplay(a, false)
				results[idx] = res
				return
			}
			if tokenUpdated {
				credPayload = refreshed
				_ = cred.WriteAccountCredential(a.ID, credPayload)
			}

			lastSnap := &a.Quota
			quotaSnap, quotaErr := s.quotaSvc.FetchCompleteQuota(ctx, credPayload.Token.AccessToken, lastSnap)
			if quotaErr != nil && errors.Is(quotaErr, quota.ErrUnauthorized) {
				if forceRefreshed, _, rErr := s.oauthSvc.EnsureFreshToken(ctx, credPayload, true); rErr == nil {
					credPayload = forceRefreshed
					_ = cred.WriteAccountCredential(a.ID, credPayload)
					quotaSnap, quotaErr = s.quotaSvc.FetchCompleteQuota(ctx, credPayload.Token.AccessToken, lastSnap)
				}
			}

			a.Quota = quotaSnap
			res.Success = (quotaErr == nil)
			if quotaErr != nil {
				res.ErrorMessage = fmt.Sprintf("%v", quotaErr)
			}
			res.Account = toDisplay(a, false)
			results[idx] = res
		}(i, acc)
	}

	wg.Wait()

	// Merge updated accounts by ID and save to disk ONCE
	accountMap := make(map[string]AccountDisplay)
	for _, res := range results {
		accountMap[res.AccountID] = res.Account
	}

	for i := range accounts {
		if updated, ok := accountMap[accounts[i].ID]; ok {
			accounts[i].Quota.SubscriptionTier = updated.SubscriptionTier
			accounts[i].Quota.RemainingPercentage = updated.RemainingPercentage
			accounts[i].Quota.ResetTime = updated.ResetTime
			accounts[i].Quota.LastRefreshedAt = updated.LastRefreshedAt
			accounts[i].Quota.Groups = updated.Groups
			accounts[i].Quota.Models = updated.Models
			accounts[i].Quota.IsForbidden = updated.IsForbidden
			accounts[i].Quota.ErrorMessage = updated.ErrorMessage
		}
	}

	_ = s.storageMgr.SaveAccounts(accounts)
	return results, nil
}

// SwitchAccount switches Antigravity active account to the specified account.
func (s *AppService) SwitchAccount(id string) (*client.SwitchResult, error) {
	lock, err := s.tryLock()
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	accounts, _, err := s.storageMgr.LoadAccounts()
	if err != nil {
		return nil, NewAppError("STORAGE_ERROR", fmt.Sprintf("加载本地账号失败: %v", err))
	}

	var targetIndex = -1
	for idx, acc := range accounts {
		if acc.ID == id {
			targetIndex = idx
			break
		}
	}
	if targetIndex < 0 {
		return nil, NewAppError("NOT_FOUND", "未找到指定账号")
	}

	// Read independent credential
	credPayload, err := cred.ReadAccountCredential(id)
	if err != nil {
		return nil, NewAppError("CRED_NOT_FOUND", "账号独立凭据丢失，请重新收录该账号")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Ensure token is fresh before switching
	refreshed, tokenUpdated, err := s.oauthSvc.EnsureFreshToken(ctx, credPayload, false)
	if err != nil {
		if errors.Is(err, oauth.ErrInvalidGrant) {
			return nil, NewAppError("INVALID_GRANT", "账号登录已失效，请重新登录后收录")
		}
		// Continue with current token if refresh fails
	} else if tokenUpdated {
		credPayload = refreshed
		_ = cred.WriteAccountCredential(id, credPayload)
	}

	settings, _, _ := s.storageMgr.LoadSettings()
	clientPath := ""
	if settings != nil {
		clientPath = settings.ClientPath
	}

	// Perform switch
	switchResult, err := s.switcher.SwitchAccount(credPayload, clientPath)
	if err != nil {
		return nil, NewAppError("SWITCH_FAILED", fmt.Sprintf("切换账号失败: %v", err))
	}

	// Update last switched timestamp
	nowStr := time.Now().UTC().Format(time.RFC3339)
	accounts[targetIndex].LastSwitchedAt = nowStr
	_ = s.storageMgr.SaveAccounts(accounts)

	return switchResult, nil
}

// DeleteAccount removes an account from CodeTool storage and its independent credential.
func (s *AppService) DeleteAccount(id string) error {
	lock, err := s.tryLock()
	if err != nil {
		return err
	}
	defer lock.Unlock()

	accounts, _, err := s.storageMgr.LoadAccounts()
	if err != nil {
		return NewAppError("STORAGE_ERROR", fmt.Sprintf("加载本地账号失败: %v", err))
	}

	var remaining []storage.AccountRecord
	var found bool
	for _, acc := range accounts {
		if acc.ID == id {
			found = true
			continue
		}
		remaining = append(remaining, acc)
	}

	if !found {
		return NewAppError("NOT_FOUND", "未找到指定账号")
	}

	// 1. First commit the updated list to TOML
	if err := s.storageMgr.SaveAccounts(remaining); err != nil {
		return NewAppError("SAVE_FAILED", fmt.Sprintf("更新账号列表失败: %v", err))
	}

	// 2. Then delete the independent credential
	if err := cred.DeleteAccountCredential(id); err != nil {
		return NewAppError("CRED_DELETE_WARNING", fmt.Sprintf("账号记录已删除，但清理系统凭据时提示: %v", err))
	}

	return nil
}

// SaveClientPath saves the user-selected Antigravity executable path into settings.toml.
func (s *AppService) SaveClientPath(path string) error {
	settings, _, err := s.storageMgr.LoadSettings()
	if err != nil {
		settings = &storage.SettingsFile{FormatVersion: storage.CurrentFormatVersion}
	}
	settings.ClientPath = path
	return s.storageMgr.SaveSettings(settings)
}

// GetClientPath returns the configured client path from settings.toml.
func (s *AppService) GetClientPath() string {
	settings, _, _ := s.storageMgr.LoadSettings()
	if settings != nil {
		return settings.ClientPath
	}
	return ""
}
