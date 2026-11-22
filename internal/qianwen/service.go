package qianwen

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"graviton/internal/cred"
	"graviton/internal/storage"

	"github.com/google/uuid"
)

const defaultBatchRefreshConcurrency = 3

// CredStore abstracts Qianwen credential persistence so tests do not touch Windows Credential Manager.
type CredStore interface {
	Read(accountID string) (*cred.QianwenCredentialPayload, error)
	Write(accountID string, payload *cred.QianwenCredentialPayload) error
	Delete(accountID string) error
}

type windowsCredStore struct{}

func (windowsCredStore) Read(accountID string) (*cred.QianwenCredentialPayload, error) {
	return cred.ReadQianwenCredential(accountID)
}

func (windowsCredStore) Write(accountID string, payload *cred.QianwenCredentialPayload) error {
	return cred.WriteQianwenCredential(accountID, payload)
}

func (windowsCredStore) Delete(accountID string) error {
	return cred.DeleteQianwenCredential(accountID)
}

// Service manages Qianwen device-flow authentication, credential persistence, and Token Plan quota refresh.
type Service struct {
	storageMgr *storage.StorageManager
	client     *Client
	creds      CredStore
	now        func() time.Time

	opLock sync.Mutex

	authMu         sync.Mutex
	activeSession  string
	activeCancel   context.CancelFunc
}

// NewService constructs a Qianwen Service with optional custom Client and CredStore.
func NewService(sm *storage.StorageManager, client *Client, credStore CredStore) *Service {
	if client == nil {
		client = NewClient(nil)
	}
	if credStore == nil {
		credStore = windowsCredStore{}
	}
	return &Service{
		storageMgr: sm,
		client:     client,
		creds:      credStore,
		now:        client.now,
	}
}

// IsBusy reports whether a Qianwen state-mutating operation is currently running.
func (s *Service) IsBusy() bool {
	if s.opLock.TryLock() {
		s.opLock.Unlock()
		return false
	}
	return true
}

// ListAccounts returns all stored Qianwen accounts in sanitized display form.
func (s *Service) ListAccounts() ([]AccountDisplay, error) {
	if s.storageMgr == nil {
		return []AccountDisplay{}, nil
	}
	records, _, err := s.storageMgr.LoadQianwenAccounts()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 加载千问账号列表失败: %w", err)
	}
	out := make([]AccountDisplay, 0, len(records))
	for _, r := range records {
		out = append(out, toAccountDisplay(r))
	}
	return out, nil
}

// StartAuth initiates a Qianwen Device Authorization + PKCE session and polls asynchronously.
func (s *Service) StartAuth(reauthAccountID string, onEvent func(AuthEvent)) (*AuthStartResponse, error) {
	if s.storageMgr == nil {
		return nil, errors.New("[STORAGE_ERROR] 存储管理器未初始化")
	}

	clientID, err := s.getOrCreateDeviceClientID()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取千问设备标识失败: %w", err)
	}

	initCtx, initCancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer initCancel()
	start, err := s.client.StartDeviceAuth(initCtx, clientID)
	if err != nil {
		return nil, fmt.Errorf("[QIANWEN_AUTH_INIT_FAILED] 发起千问授权失败: %w", err)
	}

	// Cancel any previously running auth poll before starting the new one.
	s.CancelAuth()

	sessionID := uuid.NewString()
	pollCtx, pollCancel := context.WithCancel(context.Background())

	s.authMu.Lock()
	s.activeSession = sessionID
	s.activeCancel = pollCancel
	s.authMu.Unlock()

	go s.runAuthSession(pollCtx, sessionID, reauthAccountID, start, onEvent)

	return &AuthStartResponse{
		SessionID:       sessionID,
		VerificationURL: start.VerificationURL,
		DeviceCode:      start.DeviceCode,
		ExpiresIn:       start.ExpiresIn,
		Interval:        start.Interval,
	}, nil
}

// CancelAuth cancels any active Qianwen device authorization polling loop.
func (s *Service) CancelAuth() {
	s.authMu.Lock()
	cancel := s.activeCancel
	sessionID := s.activeSession
	s.activeCancel = nil
	s.activeSession = ""
	s.authMu.Unlock()

	if cancel != nil {
		cancel()
	}
	_ = sessionID
}

func (s *Service) clearAuthSession(sessionID string) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	if s.activeSession == sessionID {
		s.activeCancel = nil
		s.activeSession = ""
	}
}

func (s *Service) runAuthSession(
	ctx context.Context,
	sessionID string,
	reauthAccountID string,
	start *DeviceAuthStart,
	onEvent func(AuthEvent),
) {
	defer s.clearAuthSession(sessionID)

	emit := func(evt AuthEvent) {
		evt.SessionID = sessionID
		if onEvent != nil {
			onEvent(evt)
		}
	}

	creds, err := s.client.PollDeviceToken(ctx, start, func(status string, interval int) {
		emit(AuthEvent{Status: status, Interval: interval})
	})
	if err != nil {
		switch {
		case errors.Is(err, context.Canceled):
			emit(AuthEvent{Status: "cancelled", Error: "已取消千问授权"})
		case errors.Is(err, ErrDeviceExpired):
			emit(AuthEvent{Status: "expired", Error: "授权码已过期，请重新发起授权"})
		case errors.Is(err, ErrDeviceSessionInvalid):
			emit(AuthEvent{Status: "expired", Error: "授权会话已失效或已被使用，请重新发起授权"})
		case errors.Is(err, ErrAccessDenied):
			emit(AuthEvent{Status: "denied", Error: "用户已拒绝千问授权"})
		default:
			emit(AuthEvent{Status: "error", Error: fmt.Sprintf("千问授权失败: %v", err)})
		}
		return
	}

	emit(AuthEvent{Status: "completing"})

	account, err := s.completeAuth(ctx, reauthAccountID, start.ClientID, creds)
	if err != nil {
		emit(AuthEvent{Status: "error", Error: err.Error()})
		return
	}
	emit(AuthEvent{Status: "complete", Account: account})
}

func (s *Service) completeAuth(
	ctx context.Context,
	reauthAccountID string,
	clientID string,
	tokenCreds *TokenCredentials,
) (*AccountDisplay, error) {
	profile := tokenCreds.User
	infoCtx, infoCancel := context.WithTimeout(ctx, 6*time.Second)
	info, infoErr := s.client.FetchAccountInfo(infoCtx, tokenCreds.AccessToken)
	infoCancel()
	if infoErr == nil && info != nil {
		if info.ID != "" && profile.ID == "" {
			profile.ID = info.ID
		}
		if info.AliyunID != "" {
			profile.AliyunID = info.AliyunID
		}
		if info.Email != "" {
			profile.Email = info.Email
		}
	}

	payload := &cred.QianwenCredentialPayload{
		AccessToken:  tokenCreds.AccessToken,
		RefreshToken: tokenCreds.RefreshToken,
		ExpiresAt:    tokenCreds.ExpiresAt,
		ClientID:     clientID,
		UserID:       profile.ID,
		Email:        profile.Email,
		AliyunID:     profile.AliyunID,
	}

	s.opLock.Lock()
	records, _, err := s.storageMgr.LoadQianwenAccounts()
	if err != nil {
		s.opLock.Unlock()
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取千问账号存储失败: %w", err)
	}

	idx := matchExistingQianwenRecord(records, reauthAccountID, profile)
	accountID := uuid.NewString()
	createdAt := s.now().UTC().Format(time.RFC3339)
	if idx >= 0 {
		accountID = records[idx].ID
		if records[idx].CreatedAt != "" {
			createdAt = records[idx].CreatedAt
		}
	}

	if err := s.creds.Write(accountID, payload); err != nil {
		s.opLock.Unlock()
		return nil, fmt.Errorf("[CRED_WRITE_ERROR] 保存千问凭据失败: %w", err)
	}

	displayName := firstNonEmpty(profile.Email, profile.AliyunID, profile.ID, "千问账号")
	rec := storage.QianwenAccountRecord{
		ID:             accountID,
		UserID:         profile.ID,
		AliyunID:       profile.AliyunID,
		Email:          profile.Email,
		Name:           displayName,
		TokenExpiresAt: tokenCreds.ExpiresAt,
		CreatedAt:      createdAt,
		Quota: storage.QianwenQuotaSnapshot{
			LastRefreshedAt: s.now().UTC().Format(time.RFC3339),
		},
	}

	if idx >= 0 {
		records[idx] = rec
	} else {
		records = append(records, rec)
	}
	if err := s.storageMgr.SaveQianwenAccounts(records); err != nil {
		s.opLock.Unlock()
		return nil, fmt.Errorf("[STORAGE_ERROR] 保存千问账号失败: %w", err)
	}
	s.opLock.Unlock()

	// Best-effort initial quota fetch after persisting credentials & account record.
	fetchCtx, cancelFetch := context.WithTimeout(ctx, 15*time.Second)
	var updatedPayload *cred.QianwenCredentialPayload
	snapshot, quotaErr := s.client.FetchTokenPlanUsage(fetchCtx, payload, func(p *cred.QianwenCredentialPayload) {
		cp := *p
		updatedPayload = &cp
	})
	cancelFetch()

	if updatedPayload != nil {
		_ = s.creds.Write(accountID, updatedPayload)
	}

	if quotaErr == nil && snapshot != nil {
		rec.Quota = *snapshot
	} else if quotaErr != nil {
		rec.Quota.ErrorMessage = quotaErr.Error()
	}

	s.opLock.Lock()
	latest, _, loadErr := s.storageMgr.LoadQianwenAccounts()
	if loadErr == nil {
		for i := range latest {
			if latest[i].ID == accountID {
				latest[i].Quota = rec.Quota
				_ = s.storageMgr.SaveQianwenAccounts(latest)
				break
			}
		}
	}
	s.opLock.Unlock()

	disp := toAccountDisplay(rec)
	return &disp, nil
}

// RefreshAccount refreshes Token Plan usage for a single Qianwen account.
func (s *Service) RefreshAccount(accountID string) (*AccountDisplay, error) {
	if s.storageMgr == nil {
		return nil, errors.New("[STORAGE_ERROR] 存储管理器未初始化")
	}
	records, _, err := s.storageMgr.LoadQianwenAccounts()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取千问账号失败: %w", err)
	}

	var target *storage.QianwenAccountRecord
	for i := range records {
		if records[i].ID == accountID {
			copyRec := records[i]
			target = &copyRec
			break
		}
	}
	if target == nil {
		return nil, errors.New("[NOT_FOUND] 未找到指定的千问账号")
	}

	payload, err := s.creds.Read(accountID)
	if err != nil {
		if errors.Is(err, cred.ErrNotFound) {
			s.markAuthExpired(accountID)
			return nil, errors.New("[AUTH_REQUIRED] 千问凭据已丢失，请重新授权")
		}
		return nil, fmt.Errorf("[CRED_READ_ERROR] 读取千问凭据失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var updatedPayload *cred.QianwenCredentialPayload
	snapshot, err := s.client.FetchTokenPlanUsage(ctx, payload, func(p *cred.QianwenCredentialPayload) {
		cp := *p
		updatedPayload = &cp
	})
	if err != nil {
		if errors.Is(err, ErrAuthRequired) {
			s.markAuthExpired(accountID)
			return nil, errors.New("[AUTH_REQUIRED] 千问登录已过期，请重新授权")
		}
		return nil, fmt.Errorf("[QIANWEN_QUOTA_ERROR] 查询千问额度失败: %w", err)
	}

	if updatedPayload != nil {
		_ = s.creds.Write(accountID, updatedPayload)
	}

	s.opLock.Lock()
	defer s.opLock.Unlock()

	latest, _, err := s.storageMgr.LoadQianwenAccounts()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取千问账号失败: %w", err)
	}
	for i := range latest {
		if latest[i].ID == accountID {
			latest[i].Quota = *snapshot
			if payload.ExpiresAt != "" {
				latest[i].TokenExpiresAt = payload.ExpiresAt
			}
			if err := s.storageMgr.SaveQianwenAccounts(latest); err != nil {
				return nil, fmt.Errorf("[STORAGE_ERROR] 保存千问额度失败: %w", err)
			}
			disp := toAccountDisplay(latest[i])
			return &disp, nil
		}
	}

	return nil, errors.New("[NOT_FOUND] 未找到指定的千问账号")
}

// RefreshAllAccounts refreshes all stored Qianwen accounts concurrently with bounded workers.
func (s *Service) RefreshAllAccounts(onProgress func(BatchRefreshResult)) ([]BatchRefreshResult, error) {
	if !s.opLock.TryLock() {
		return nil, errors.New("[BUSY] 正在操作千问账号，请稍候")
	}

	if s.storageMgr == nil {
		s.opLock.Unlock()
		return []BatchRefreshResult{}, nil
	}

	records, _, err := s.storageMgr.LoadQianwenAccounts()
	s.opLock.Unlock()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取千问账号失败: %w", err)
	}
	if len(records) == 0 {
		return []BatchRefreshResult{}, nil
	}

	type workResult struct {
		idx            int
		result         BatchRefreshResult
		updatedSnap    *storage.QianwenQuotaSnapshot
		updatedPayload *cred.QianwenCredentialPayload
	}

	jobs := make(chan int, len(records))
	outCh := make(chan workResult, len(records))

	workers := defaultBatchRefreshConcurrency
	if len(records) < workers {
		workers = len(records)
	}

	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range jobs {
				rec := records[idx]
				label := firstNonEmpty(rec.Name, rec.Email, rec.AliyunID, rec.ID)
				payload, readErr := s.creds.Read(rec.ID)
				if readErr != nil {
					snap := rec.Quota
					snap.AuthExpired = true
					snap.ErrorMessage = "凭据已丢失，请重新授权"
					res := BatchRefreshResult{
						AccountID: rec.ID,
						Label:     label,
						Success:   false,
						Error:     "千问凭据已丢失，请重新授权",
					}
					if onProgress != nil {
						onProgress(res)
					}
					outCh <- workResult{idx: idx, result: res, updatedSnap: &snap}
					continue
				}

				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				var refreshedCred *cred.QianwenCredentialPayload
				snap, fetchErr := s.client.FetchTokenPlanUsage(ctx, payload, func(p *cred.QianwenCredentialPayload) {
					cp := *p
					refreshedCred = &cp
				})
				cancel()

				if fetchErr != nil {
					nextSnap := rec.Quota
					errMsg := fetchErr.Error()
					if errors.Is(fetchErr, ErrAuthRequired) {
						nextSnap.AuthExpired = true
						nextSnap.ErrorMessage = "登录已过期，请重新授权"
						errMsg = "登录已过期，请重新授权"
					}
					res := BatchRefreshResult{
						AccountID: rec.ID,
						Label:     label,
						Success:   false,
						Error:     errMsg,
					}
					if onProgress != nil {
						onProgress(res)
					}
					outCh <- workResult{idx: idx, result: res, updatedSnap: &nextSnap}
					continue
				}

				disp := toAccountDisplay(storage.QianwenAccountRecord{
					ID:             rec.ID,
					UserID:         rec.UserID,
					AliyunID:       rec.AliyunID,
					Email:          rec.Email,
					Name:           rec.Name,
					TokenExpiresAt: rec.TokenExpiresAt,
					CreatedAt:      rec.CreatedAt,
					Quota:          *snap,
				})
				res := BatchRefreshResult{
					AccountID: rec.ID,
					Label:     label,
					Success:   true,
					Account:   &disp,
				}
				if onProgress != nil {
					onProgress(res)
				}
				outCh <- workResult{
					idx:            idx,
					result:         res,
					updatedSnap:    snap,
					updatedPayload: refreshedCred,
				}
			}
		}()
	}

	for i := range records {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	close(outCh)

	results := make([]BatchRefreshResult, len(records))
	snapsByID := make(map[string]storage.QianwenQuotaSnapshot, len(records))
	for wr := range outCh {
		results[wr.idx] = wr.result
		if wr.updatedSnap != nil {
			snapsByID[records[wr.idx].ID] = *wr.updatedSnap
		}
		if wr.updatedPayload != nil {
			_ = s.creds.Write(records[wr.idx].ID, wr.updatedPayload)
		}
	}

	s.opLock.Lock()
	latest, _, loadErr := s.storageMgr.LoadQianwenAccounts()
	if loadErr == nil {
		for i := range latest {
			if snap, ok := snapsByID[latest[i].ID]; ok {
				latest[i].Quota = snap
			}
		}
		_ = s.storageMgr.SaveQianwenAccounts(latest)
	}
	s.opLock.Unlock()

	return results, nil
}

// DeleteAccount removes a Qianwen account, revoking its remote session best-effort and deleting its credential.
func (s *Service) DeleteAccount(accountID string) error {
	if s.storageMgr == nil {
		return errors.New("[STORAGE_ERROR] 存储管理器未初始化")
	}

	if payload, err := s.creds.Read(accountID); err == nil && payload != nil && payload.AccessToken != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = s.client.Logout(ctx, payload.AccessToken)
		cancel()
	}

	s.opLock.Lock()
	defer s.opLock.Unlock()

	records, _, err := s.storageMgr.LoadQianwenAccounts()
	if err != nil {
		return fmt.Errorf("[STORAGE_ERROR] 读取千问账号失败: %w", err)
	}

	filtered := make([]storage.QianwenAccountRecord, 0, len(records))
	found := false
	for _, r := range records {
		if r.ID == accountID {
			found = true
			continue
		}
		filtered = append(filtered, r)
	}
	if !found {
		return errors.New("[NOT_FOUND] 未找到指定的千问账号")
	}

	if err := s.storageMgr.SaveQianwenAccounts(filtered); err != nil {
		return fmt.Errorf("[STORAGE_ERROR] 保存千问账号失败: %w", err)
	}
	if err := s.creds.Delete(accountID); err != nil && !errors.Is(err, cred.ErrNotFound) {
		return fmt.Errorf("[CRED_DELETE_ERROR] 删除千问凭据失败: %w", err)
	}
	return nil
}

func (s *Service) markAuthExpired(accountID string) {
	s.opLock.Lock()
	defer s.opLock.Unlock()

	records, _, err := s.storageMgr.LoadQianwenAccounts()
	if err != nil {
		return
	}
	for i := range records {
		if records[i].ID == accountID {
			records[i].Quota.AuthExpired = true
			records[i].Quota.ErrorMessage = "登录已过期，请重新授权"
			_ = s.storageMgr.SaveQianwenAccounts(records)
			return
		}
	}
}

func (s *Service) getOrCreateDeviceClientID() (string, error) {
	s.opLock.Lock()
	defer s.opLock.Unlock()

	sf, _, err := s.storageMgr.LoadSettings()
	if err != nil {
		return "", err
	}
	if id := strings.TrimSpace(sf.QianwenDeviceClientID); id != "" {
		return id, nil
	}
	id := uuid.NewString()
	sf.QianwenDeviceClientID = id
	if err := s.storageMgr.SaveSettings(sf); err != nil {
		return "", err
	}
	return id, nil
}

func matchExistingQianwenRecord(records []storage.QianwenAccountRecord, reauthAccountID string, profile UserProfile) int {
	if reauthAccountID != "" {
		for i, r := range records {
			if r.ID == reauthAccountID {
				return i
			}
		}
	}
	for i, r := range records {
		if profile.AliyunID != "" && r.AliyunID != "" && strings.EqualFold(r.AliyunID, profile.AliyunID) {
			return i
		}
		if profile.Email != "" && r.Email != "" && strings.EqualFold(r.Email, profile.Email) {
			return i
		}
		if profile.ID != "" && r.UserID != "" && r.UserID == profile.ID {
			return i
		}
	}
	return -1
}

func toAccountDisplay(r storage.QianwenAccountRecord) AccountDisplay {
	quota := r.Quota
	if quota.Personal != nil && quota.Personal.Cycles == nil {
		quota.Personal.Cycles = []storage.QianwenUsageCycle{}
	}
	if quota.Team != nil && quota.Team.SeatGroups == nil {
		quota.Team.SeatGroups = []storage.QianwenTeamSeatGroup{}
	}
	return AccountDisplay{
		ID:             r.ID,
		UserID:         r.UserID,
		AliyunID:       r.AliyunID,
		Email:          r.Email,
		Name:           r.Name,
		TokenExpiresAt: r.TokenExpiresAt,
		CreatedAt:      r.CreatedAt,
		Quota:          quota,
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}
