package deepseek

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"graviton/internal/cred"
	"graviton/internal/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type memCredStore struct {
	mu    sync.Mutex
	items map[string]cred.DeepSeekCredentialPayload
}

func newMemCredStore() *memCredStore {
	return &memCredStore{items: make(map[string]cred.DeepSeekCredentialPayload)}
}

func (m *memCredStore) Read(accountID string) (*cred.DeepSeekCredentialPayload, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.items[accountID]
	if !ok {
		return nil, cred.ErrNotFound
	}
	cp := v
	return &cp, nil
}

func (m *memCredStore) Write(accountID string, payload *cred.DeepSeekCredentialPayload) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.items[accountID] = *payload
	return nil
}

func (m *memCredStore) Delete(accountID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.items[accountID]; !ok {
		return cred.ErrNotFound
	}
	delete(m.items, accountID)
	return nil
}

func TestService_AddUpdateRefreshDeleteLifecycle(t *testing.T) {
	var mu sync.Mutex
	keyResponses := map[string]struct {
		status int
		body   string
	}{
		"sk-key-one-1234567890": {
			status: http.StatusOK,
			body:   `{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"110.00","granted_balance":"10.00","topped_up_balance":"100.00"}]}`,
		},
		"sk-key-two-abcdefghij": {
			status: http.StatusOK,
			body:   `{"is_available":false,"balance_infos":[{"currency":"USD","total_balance":"0.00","granted_balance":"0.00","topped_up_balance":"0.00"}]}`,
		},
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		key := ""
		if len(auth) > 7 {
			key = auth[7:]
		}
		mu.Lock()
		resp, ok := keyResponses[key]
		mu.Unlock()
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"invalid key"}}`))
			return
		}
		w.WriteHeader(resp.status)
		_, _ = w.Write([]byte(resp.body))
	}))
	defer srv.Close()

	dir := t.TempDir()
	sm, err := storage.NewStorageManager(dir)
	require.NoError(t, err)

	client := NewClient(srv.Client())
	client.baseURL = srv.URL
	client.now = func() time.Time { return time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC) }
	creds := newMemCredStore()
	svc := NewService(sm, client, creds)

	// 1. Reject invalid key without saving
	_, err = svc.AddAccount("坏账号", "sk-invalid-key-0000")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "[AUTH_INVALID]")
	list, err := svc.ListAccounts()
	require.NoError(t, err)
	assert.Empty(t, list)

	// 2. Add valid key (also strips accidental "Bearer " prefix)
	acc1, err := svc.AddAccount("", "Bearer sk-key-one-1234567890")
	require.NoError(t, err)
	assert.Equal(t, "DeepSeek 账号 1", acc1.Name)
	assert.Equal(t, "sk-key-...7890", acc1.KeyPreview)
	assert.True(t, acc1.Balance.IsAvailable)
	require.Len(t, acc1.Balance.BalanceInfos, 1)
	assert.Equal(t, "110.00", acc1.Balance.BalanceInfos[0].TotalBalance)

	// Verify raw API key is NOT written to TOML
	tomlBytes, err := os.ReadFile(filepath.Join(dir, storage.DeepSeekAccountsFileName))
	require.NoError(t, err)
	assert.NotContains(t, string(tomlBytes), "sk-key-one-1234567890")

	// 3. Reject duplicate key
	_, err = svc.AddAccount("重复", "sk-key-one-1234567890")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "[DUPLICATE_KEY]")

	// 4. Rename account without changing key
	renamed, err := svc.UpdateAccount(acc1.ID, "个人主力", "")
	require.NoError(t, err)
	assert.Equal(t, "个人主力", renamed.Name)
	assert.Equal(t, "sk-key-...7890", renamed.KeyPreview)

	// 5. Simulate key becoming revoked on refresh -> marks AuthInvalid while preserving last balance
	mu.Lock()
	delete(keyResponses, "sk-key-one-1234567890")
	mu.Unlock()

	_, err = svc.RefreshAccount(acc1.ID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "[AUTH_INVALID]")

	list, err = svc.ListAccounts()
	require.NoError(t, err)
	require.Len(t, list, 1)
	assert.True(t, list[0].Balance.AuthInvalid)
	require.Len(t, list[0].Balance.BalanceInfos, 1)
	assert.Equal(t, "110.00", list[0].Balance.BalanceInfos[0].TotalBalance)

	// 6. Replace with a new valid key -> clears AuthInvalid and updates snapshot
	replaced, err := svc.UpdateAccount(acc1.ID, "海外美元号", "sk-key-two-abcdefghij")
	require.NoError(t, err)
	assert.Equal(t, "海外美元号", replaced.Name)
	assert.Equal(t, "sk-key-...ghij", replaced.KeyPreview)
	assert.False(t, replaced.Balance.AuthInvalid)
	assert.False(t, replaced.Balance.IsAvailable)
	require.Len(t, replaced.Balance.BalanceInfos, 1)
	assert.Equal(t, "USD", replaced.Balance.BalanceInfos[0].Currency)

	// 7. RefreshAllAccounts concurrently
	var progressCount int
	results, err := svc.RefreshAllAccounts(func(item BatchRefreshResult) {
		progressCount++
	})
	require.NoError(t, err)
	assert.Equal(t, 1, progressCount)
	require.Len(t, results, 1)
	assert.True(t, results[0].Success)

	// 8. Delete removes record and credential
	require.NoError(t, svc.DeleteAccount(acc1.ID))
	list, err = svc.ListAccounts()
	require.NoError(t, err)
	assert.Empty(t, list)
	_, credErr := creds.Read(acc1.ID)
	assert.ErrorIs(t, credErr, cred.ErrNotFound)

	_ = context.Background()
}

func TestMaskAPIKey(t *testing.T) {
	assert.Equal(t, "sk-1234...9012", MaskAPIKey("sk-123456789012"))
	assert.Equal(t, "abcd...ijkl", MaskAPIKey("abcdefghijkl"))
	assert.Equal(t, "ab...ef", MaskAPIKey("abcdef"))
	assert.Equal(t, "****", MaskAPIKey("1234"))
	assert.Equal(t, "", MaskAPIKey("   "))
}
