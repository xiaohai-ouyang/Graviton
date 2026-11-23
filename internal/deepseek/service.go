package deepseek

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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

// CredStore abstracts DeepSeek credential persistence so tests do not touch Windows Credential Manager.
type CredStore interface {
	Read(accountID string) (*cred.DeepSeekCredentialPayload, error)
	Write(accountID string, payload *cred.DeepSeekCredentialPayload) error
	Delete(accountID string) error
}

type windowsCredStore struct{}

func (windowsCredStore) Read(accountID string) (*cred.DeepSeekCredentialPayload, error) {
	return cred.ReadDeepSeekCredential(accountID)
}

func (windowsCredStore) Write(accountID string, payload *cred.DeepSeekCredentialPayload) error {
	return cred.WriteDeepSeekCredential(accountID, payload)
}

func (windowsCredStore) Delete(accountID string) error {
	return cred.DeleteDeepSeekCredential(accountID)
}

// Service manages DeepSeek API key credentials, account metadata, and balance refresh.
type Service struct {
	storageMgr *storage.StorageManager
	client     *Client
	creds      CredStore
	now        func() time.Time

	opLock sync.Mutex
}

// NewService constructs a DeepSeek Service with optional custom Client and CredStore.
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

// IsBusy reports whether a DeepSeek state-mutating operation is currently running.
func (s *Service) IsBusy() bool {
	if s.opLock.TryLock() {
		s.opLock.Unlock()
		return false
	}
	return true
}

// ListAccounts returns all stored DeepSeek accounts in sanitized display form.
func (s *Service) ListAccounts() ([]AccountDisplay, error) {
	if s.storageMgr == nil {
		return []AccountDisplay{}, nil
	}
	records, _, err := s.storageMgr.LoadDeepSeekAccounts()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 加载 DeepSeek 账号列表失败: %w", err)
	}
	out := make([]AccountDisplay, 0, len(records))
	for _, r := range records {
		out = append(out, toAccountDisplay(r))
	}
	return out, nil
}

// AddAccount validates a DeepSeek API key against GET /user/balance, fetches its initial
// balance snapshot, stores the key in Windows Credential Manager, and persists metadata.
func (s *Service) AddAccount(name string, rawAPIKey string) (*AccountDisplay, error) {
	if s.storageMgr == nil {
		return nil, errors.New("[STORAGE_ERROR] 存储管理器未初始化")
	}

	apiKey := sanitizeAPIKeyInput(rawAPIKey)
	if apiKey == "" {
		return nil, errors.New("[INVALID_INPUT] 请输入有效的 DeepSeek API Key")
	}
	fp := fingerprintAPIKey(apiKey)

	// Fast duplicate check before hitting the network.
	s.opLock.Lock()
	existing, _, err := s.storageMgr.LoadDeepSeekAccounts()
	s.opLock.Unlock()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取 DeepSeek 账号存储失败: %w", err)
	}
	for _, r := range existing {
		if r.KeyFingerprint != "" && r.KeyFingerprint == fp {
			return nil, errors.New("[DUPLICATE_KEY] 该 DeepSeek API Key 已添加，请勿重复添加")
		}
	}

	// Validate the key and pull its initial balance snapshot before persisting anything.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	snapshot, fetchErr := s.client.FetchBalance(ctx, apiKey)
	cancel()
	if fetchErr != nil {
		if errors.Is(fetchErr, ErrAuthInvalid) {
			return nil, errors.New("[AUTH_INVALID] API Key 无效或已失效，请检查后重试")
		}
		return nil, fmt.Errorf("[DEEPSEEK_BALANCE_ERROR] 验证 DeepSeek API Key 失败: %w", fetchErr)
	}

	s.opLock.Lock()
	defer s.opLock.Unlock()

	records, _, err := s.storageMgr.LoadDeepSeekAccounts()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取 DeepSeek 账号存储失败: %w", err)
	}
	for _, r := range records {
		if r.KeyFingerprint != "" && r.KeyFingerprint == fp {
			return nil, errors.New("[DUPLICATE_KEY] 该 DeepSeek API Key 已添加，请勿重复添加")
		}
	}

	accountID := uuid.NewString()
	displayName := strings.TrimSpace(name)
	if displayName == "" {
		displayName = nextDefaultAccountName(records)
	}

	if err := s.creds.Write(accountID, &cred.DeepSeekCredentialPayload{APIKey: apiKey}); err != nil {
		return nil, fmt.Errorf("[CRED_WRITE_ERROR] 保存 DeepSeek API Key 凭据失败: %w", err)
	}

	rec := storage.DeepSeekAccountRecord{
		ID:             accountID,
		Name:           displayName,
		KeyPreview:     MaskAPIKey(apiKey),
		KeyFingerprint: fp,
		CreatedAt:      s.now().UTC().Format(time.RFC3339),
		Balance:        *snapshot,
	}

	records = append(records, rec)
	if err := s.storageMgr.SaveDeepSeekAccounts(records); err != nil {
		_ = s.creds.Delete(accountID)
		return nil, fmt.Errorf("[STORAGE_ERROR] 保存 DeepSeek 账号失败: %w", err)
	}

	disp := toAccountDisplay(rec)
	return &disp, nil
}

// UpdateAccount updates a DeepSeek account's alias and/or replaces its API key.
// When rawAPIKey is non-empty, the new key is validated immediately against GET /user/balance
// before overwriting the stored credential and balance snapshot.
func (s *Service) UpdateAccount(accountID string, name string, rawAPIKey string) (*AccountDisplay, error) {
	if s.storageMgr == nil {
		return nil, errors.New("[STORAGE_ERROR] 存储管理器未初始化")
	}
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		return nil, errors.New("[NOT_FOUND] 未找到指定的 DeepSeek 账号")
	}

	trimmedName := strings.TrimSpace(name)
	newKey := sanitizeAPIKeyInput(rawAPIKey)
	if trimmedName == "" && newKey == "" {
		return nil, errors.New("[INVALID_INPUT] 请输入账号别名或新的 API Key")
	}

	// Pre-check existence and key uniqueness before calling external API.
	s.opLock.Lock()
	records, _, err := s.storageMgr.LoadDeepSeekAccounts()
	s.opLock.Unlock()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取 DeepSeek 账号失败: %w", err)
	}

	found := false
	var fp string
	if newKey != "" {
		fp = fingerprintAPIKey(newKey)
	}
	for _, r := range records {
		if r.ID == accountID {
			found = true
			continue
		}
		if fp != "" && r.KeyFingerprint != "" && r.KeyFingerprint == fp {
			return nil, errors.New("[DUPLICATE_KEY] 该 DeepSeek API Key 已被其他账号使用")
		}
	}
	if !found {
		return nil, errors.New("[NOT_FOUND] 未找到指定的 DeepSeek 账号")
	}

	var freshSnap *storage.DeepSeekBalanceSnapshot
	if newKey != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		snap, fetchErr := s.client.FetchBalance(ctx, newKey)
		cancel()
		if fetchErr != nil {
			if errors.Is(fetchErr, ErrAuthInvalid) {
				return nil, errors.New("[AUTH_INVALID] 新的 API Key 无效或已失效，请检查后重试")
			}
			return nil, fmt.Errorf("[DEEPSEEK_BALANCE_ERROR] 验证新 API Key 失败: %w", fetchErr)
		}
		freshSnap = snap
	}

	s.opLock.Lock()
	defer s.opLock.Unlock()

	latest, _, err := s.storageMgr.LoadDeepSeekAccounts()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取 DeepSeek 账号失败: %w", err)
	}

	targetIdx := -1
	for i := range latest {
		if latest[i].ID == accountID {
			targetIdx = i
			continue
		}
		if fp != "" && latest[i].KeyFingerprint != "" && latest[i].KeyFingerprint == fp {
			return nil, errors.New("[DUPLICATE_KEY] 该 DeepSeek API Key 已被其他账号使用")
		}
	}
	if targetIdx < 0 {
		return nil, errors.New("[NOT_FOUND] 未找到指定的 DeepSeek 账号")
	}

	if newKey != "" {
		if err := s.creds.Write(accountID, &cred.DeepSeekCredentialPayload{APIKey: newKey}); err != nil {
			return nil, fmt.Errorf("[CRED_WRITE_ERROR] 更新 DeepSeek API Key 凭据失败: %w", err)
		}
		latest[targetIdx].KeyPreview = MaskAPIKey(newKey)
		latest[targetIdx].KeyFingerprint = fp
		if freshSnap != nil {
			latest[targetIdx].Balance = *freshSnap
		}
	}

	if trimmedName != "" {
		latest[targetIdx].Name = trimmedName
	}

	if err := s.storageMgr.SaveDeepSeekAccounts(latest); err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 保存 DeepSeek 账号失败: %w", err)
	}

	disp := toAccountDisplay(latest[targetIdx])
	return &disp, nil
}

// RefreshAccount refreshes the balance for a single DeepSeek account.
func (s *Service) RefreshAccount(accountID string) (*AccountDisplay, error) {
	if s.storageMgr == nil {
		return nil, errors.New("[STORAGE_ERROR] 存储管理器未初始化")
	}
	records, _, err := s.storageMgr.LoadDeepSeekAccounts()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取 DeepSeek 账号失败: %w", err)
	}

	var target *storage.DeepSeekAccountRecord
	for i := range records {
		if records[i].ID == accountID {
			copyRec := records[i]
			target = &copyRec
			break
		}
	}
	if target == nil {
		return nil, errors.New("[NOT_FOUND] 未找到指定的 DeepSeek 账号")
	}

	payload, err := s.creds.Read(accountID)
	if err != nil {
		if errors.Is(err, cred.ErrNotFound) {
			s.markRefreshFailure(accountID, true, "本地凭据已丢失，请前往设置更新 API Key")
			return nil, errors.New("[AUTH_INVALID] DeepSeek 凭据已丢失，请前往设置更新 API Key")
		}
		return nil, fmt.Errorf("[CRED_READ_ERROR] 读取 DeepSeek 凭据失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	snapshot, fetchErr := s.client.FetchBalance(ctx, payload.APIKey)
	cancel()
	if fetchErr != nil {
		if errors.Is(fetchErr, ErrAuthInvalid) {
			s.markRefreshFailure(accountID, true, "API Key 无效或已失效，请前往设置更新 Key")
			return nil, errors.New("[AUTH_INVALID] DeepSeek API Key 已失效，请前往设置更新 Key")
		}
		s.markRefreshFailure(accountID, false, fetchErr.Error())
		return nil, fmt.Errorf("[DEEPSEEK_BALANCE_ERROR] 查询 DeepSeek 余额失败: %w", fetchErr)
	}

	s.opLock.Lock()
	defer s.opLock.Unlock()

	latest, _, err := s.storageMgr.LoadDeepSeekAccounts()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取 DeepSeek 账号失败: %w", err)
	}
	for i := range latest {
		if latest[i].ID == accountID {
			latest[i].Balance = *snapshot
			if err := s.storageMgr.SaveDeepSeekAccounts(latest); err != nil {
				return nil, fmt.Errorf("[STORAGE_ERROR] 保存 DeepSeek 余额失败: %w", err)
			}
			disp := toAccountDisplay(latest[i])
			return &disp, nil
		}
	}

	return nil, errors.New("[NOT_FOUND] 未找到指定的 DeepSeek 账号")
}

// RefreshAllAccounts refreshes all stored DeepSeek accounts concurrently with bounded workers.
func (s *Service) RefreshAllAccounts(onProgress func(BatchRefreshResult)) ([]BatchRefreshResult, error) {
	if !s.opLock.TryLock() {
		return nil, errors.New("[BUSY] 正在操作 DeepSeek 账号，请稍候")
	}

	if s.storageMgr == nil {
		s.opLock.Unlock()
		return []BatchRefreshResult{}, nil
	}

	records, _, err := s.storageMgr.LoadDeepSeekAccounts()
	s.opLock.Unlock()
	if err != nil {
		return nil, fmt.Errorf("[STORAGE_ERROR] 读取 DeepSeek 账号失败: %w", err)
	}
	if len(records) == 0 {
		return []BatchRefreshResult{}, nil
	}

	type workResult struct {
		idx         int
		result      BatchRefreshResult
		updatedSnap *storage.DeepSeekBalanceSnapshot
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
				label := firstNonEmpty(rec.Name, rec.KeyPreview, rec.ID)
				payload, readErr := s.creds.Read(rec.ID)
				if readErr != nil {
					snap := rec.Balance
					snap.AuthInvalid = true
					snap.ErrorMessage = "本地凭据已丢失，请前往设置更新 API Key"
					disp := toAccountDisplay(withBalance(rec, snap))
					res := BatchRefreshResult{
						AccountID: rec.ID,
						Label:     label,
						Success:   false,
						Account:   &disp,
						Error:     "DeepSeek 凭据已丢失，请前往设置更新 API Key",
					}
					if onProgress != nil {
						onProgress(res)
					}
					outCh <- workResult{idx: idx, result: res, updatedSnap: &snap}
					continue
				}

				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				snap, fetchErr := s.client.FetchBalance(ctx, payload.APIKey)
				cancel()

				if fetchErr != nil {
					nextSnap := rec.Balance
					errMsg := fetchErr.Error()
					if errors.Is(fetchErr, ErrAuthInvalid) {
						nextSnap.AuthInvalid = true
						nextSnap.ErrorMessage = "API Key 无效或已失效，请前往设置更新 Key"
						errMsg = "API Key 已失效，请前往设置更新 Key"
					} else {
						nextSnap.ErrorMessage = errMsg
					}
					disp := toAccountDisplay(withBalance(rec, nextSnap))
					res := BatchRefreshResult{
						AccountID: rec.ID,
						Label:     label,
						Success:   false,
						Account:   &disp,
						Error:     errMsg,
					}
					if onProgress != nil {
						onProgress(res)
					}
					outCh <- workResult{idx: idx, result: res, updatedSnap: &nextSnap}
					continue
				}

				disp := toAccountDisplay(withBalance(rec, *snap))
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
					idx:         idx,
					result:      res,
					updatedSnap: snap,
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
	snapsByID := make(map[string]storage.DeepSeekBalanceSnapshot, len(records))
	for wr := range outCh {
		results[wr.idx] = wr.result
		if wr.updatedSnap != nil {
			snapsByID[records[wr.idx].ID] = *wr.updatedSnap
		}
	}

	s.opLock.Lock()
	latest, _, loadErr := s.storageMgr.LoadDeepSeekAccounts()
	if loadErr == nil {
		for i := range latest {
			if snap, ok := snapsByID[latest[i].ID]; ok {
				latest[i].Balance = snap
			}
		}
		_ = s.storageMgr.SaveDeepSeekAccounts(latest)
	}
	s.opLock.Unlock()

	return results, nil
}

// DeleteAccount removes a DeepSeek account record and deletes its Windows Credential Manager entry.
func (s *Service) DeleteAccount(accountID string) error {
	if s.storageMgr == nil {
		return errors.New("[STORAGE_ERROR] 存储管理器未初始化")
	}

	s.opLock.Lock()
	defer s.opLock.Unlock()

	records, _, err := s.storageMgr.LoadDeepSeekAccounts()
	if err != nil {
		return fmt.Errorf("[STORAGE_ERROR] 读取 DeepSeek 账号失败: %w", err)
	}

	filtered := make([]storage.DeepSeekAccountRecord, 0, len(records))
	found := false
	for _, r := range records {
		if r.ID == accountID {
			found = true
			continue
		}
		filtered = append(filtered, r)
	}
	if !found {
		return errors.New("[NOT_FOUND] 未找到指定的 DeepSeek 账号")
	}

	if err := s.storageMgr.SaveDeepSeekAccounts(filtered); err != nil {
		return fmt.Errorf("[STORAGE_ERROR] 保存 DeepSeek 账号失败: %w", err)
	}
	if err := s.creds.Delete(accountID); err != nil && !errors.Is(err, cred.ErrNotFound) {
		return fmt.Errorf("[CRED_DELETE_ERROR] 删除 DeepSeek 凭据失败: %w", err)
	}
	return nil
}

func (s *Service) markRefreshFailure(accountID string, authInvalid bool, errMsg string) {
	s.opLock.Lock()
	defer s.opLock.Unlock()

	records, _, err := s.storageMgr.LoadDeepSeekAccounts()
	if err != nil {
		return
	}
	for i := range records {
		if records[i].ID == accountID {
			if authInvalid {
				records[i].Balance.AuthInvalid = true
			}
			records[i].Balance.ErrorMessage = errMsg
			_ = s.storageMgr.SaveDeepSeekAccounts(records)
			return
		}
	}
}

// MaskAPIKey produces a non-sensitive preview like "sk-1234...abcd".
func MaskAPIKey(apiKey string) string {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return ""
	}
	runes := []rune(key)
	n := len(runes)
	if n <= 8 {
		if n <= 4 {
			return "****"
		}
		return string(runes[:2]) + "..." + string(runes[n-2:])
	}
	if strings.HasPrefix(key, "sk-") && n >= 12 {
		return string(runes[:7]) + "..." + string(runes[n-4:])
	}
	return string(runes[:4]) + "..." + string(runes[n-4:])
}

func sanitizeAPIKeyInput(raw string) string {
	s := strings.TrimSpace(raw)
	if len(s) >= 7 && strings.EqualFold(s[:7], "bearer ") {
		s = strings.TrimSpace(s[7:])
	}
	return s
}

func fingerprintAPIKey(apiKey string) string {
	sum := sha256.Sum256([]byte(apiKey))
	return hex.EncodeToString(sum[:])
}

func nextDefaultAccountName(records []storage.DeepSeekAccountRecord) string {
	used := make(map[string]bool, len(records))
	for _, r := range records {
		used[strings.TrimSpace(r.Name)] = true
	}
	for i := 1; i <= len(records)+100; i++ {
		candidate := fmt.Sprintf("DeepSeek 账号 %d", i)
		if !used[candidate] {
			return candidate
		}
	}
	return fmt.Sprintf("DeepSeek 账号 %d", len(records)+1)
}

func withBalance(r storage.DeepSeekAccountRecord, snap storage.DeepSeekBalanceSnapshot) storage.DeepSeekAccountRecord {
	r.Balance = snap
	return r
}

func toAccountDisplay(r storage.DeepSeekAccountRecord) AccountDisplay {
	bal := r.Balance
	if bal.BalanceInfos == nil {
		bal.BalanceInfos = []storage.DeepSeekBalanceInfo{}
	}
	return AccountDisplay{
		ID:         r.ID,
		Name:       r.Name,
		KeyPreview: r.KeyPreview,
		CreatedAt:  r.CreatedAt,
		Balance:    bal,
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
