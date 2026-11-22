package qianwen

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"graviton/internal/cred"
	"graviton/internal/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type memoryCredStore struct {
	mu   sync.Mutex
	data map[string]*cred.QianwenCredentialPayload
}

func newMemoryCredStore() *memoryCredStore {
	return &memoryCredStore{data: make(map[string]*cred.QianwenCredentialPayload)}
}

func (m *memoryCredStore) Read(accountID string) (*cred.QianwenCredentialPayload, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.data[accountID]
	if !ok {
		return nil, cred.ErrNotFound
	}
	cp := *p
	return &cp, nil
}

func (m *memoryCredStore) Write(accountID string, payload *cred.QianwenCredentialPayload) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := *payload
	m.data[accountID] = &cp
	return nil
}

func (m *memoryCredStore) Delete(accountID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.data[accountID]; !ok {
		return cred.ErrNotFound
	}
	delete(m.data, accountID)
	return nil
}

func TestService_AuthRefreshAndDeleteLifecycle(t *testing.T) {
	var expiredMode atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/cli/device/code":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Success": true,
				"Data": map[string]any{
					"Token":           "dev-code-abc",
					"VerificationUrl": "https://t.qianwenai.com/device?t=abc",
					"ExpiresIn":       60,
					"Interval":        1,
				},
			})
		case "/cli/device/token":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Data": map[string]any{
					"Status": "complete",
					"Credentials": map[string]any{
						"AccessToken": "secret-primary-token-xyz",
						"ExpireTime":  time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339),
						"User": map[string]any{
							"Id":       "u-777",
							"Email":    "alice@qianwenai.com",
							"AliyunId": "alice_ali",
						},
					},
				},
			})
		case "/api/account/info.json":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"aliyunId": "alice_ali",
					"email":    "alice@qianwenai.com",
				},
			})
		case "/data/v2/api.json":
			if expiredMode.Load() {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			var req struct {
				Action string `json:"action"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			switch req.Action {
			case ActionGenerateCLIAccessToken:
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code":            "200",
					"successResponse": true,
					"data":            map[string]any{"cliAccessToken": "secret-derived-token-123"},
				})
			case ActionLogout:
				_ = json.NewEncoder(w).Encode(map[string]any{"code": "200", "data": map[string]any{}})
			default:
				_ = json.NewEncoder(w).Encode(map[string]any{"code": "200", "data": map[string]any{"Data": []any{}}})
			}
		case "/cli/api.json":
			if expiredMode.Load() {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			apiName := r.URL.Query().Get("api")
			var inner any
			switch apiName {
			case APIPersonalSubscription:
				inner = map[string]any{
					"code":    "SUCCESS",
					"success": true,
					"data": map[string]any{
						"status":        "VALID",
						"instanceCode":  "inst-1",
						"specCode":      "standard",
						"remainingDays": 20,
						"startTime":     float64(1793491200000),
						"endTime":       float64(1796083200000),
						"autoRenewFlag": false,
					},
				}
			case APIPersonalUsage:
				inner = map[string]any{
					"code":    "SUCCESS",
					"success": true,
					"data": map[string]any{
						"per1MonthPercentage": 0.15,
						"per1MonthResetTime":  float64(1796083200000),
					},
				}
			default:
				inner = map[string]any{"code": "SUCCESS", "success": true, "data": map[string]any{}}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":            "200",
				"successResponse": true,
				"data": map[string]any{
					"success":   true,
					"errorCode": "",
					"DataV2":    map[string]any{"ret": []string{"SUCCESS::ok"}, "data": inner},
				},
			})
		}
	}))
	defer srv.Close()

	sm, err := storage.NewStorageManager(t.TempDir())
	require.NoError(t, err)
	credStore := newMemoryCredStore()

	c := NewClient(srv.Client())
	c.AuthEndpoint = srv.URL
	c.APIEndpoint = srv.URL
	c.CSDataEndpoint = srv.URL
	c.Sleep = func(ctx context.Context, d time.Duration) error { return nil }

	svc := NewService(sm, c, credStore)

	doneCh := make(chan AuthEvent, 4)
	resp, err := svc.StartAuth("", func(evt AuthEvent) {
		if evt.Status == "complete" || evt.Status == "error" || evt.Status == "expired" || evt.Status == "denied" {
			doneCh <- evt
		}
	})
	require.NoError(t, err)
	assert.Equal(t, "dev-code-abc", resp.DeviceCode)

	select {
	case evt := <-doneCh:
		require.Equal(t, "complete", evt.Status)
		require.NotNil(t, evt.Account)
		assert.Equal(t, "alice@qianwenai.com", evt.Account.Email)
		assert.True(t, evt.Account.Quota.HasSubscription)
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for auth completion")
	}

	// Verify TOML persisted without plaintext tokens
	rawToml, err := os.ReadFile(filepath.Join(sm.BaseDir(), storage.QianwenAccountsFileName))
	require.NoError(t, err)
	assert.NotContains(t, string(rawToml), "secret-primary-token-xyz")
	assert.NotContains(t, string(rawToml), "secret-derived-token-123")

	list, err := svc.ListAccounts()
	require.NoError(t, err)
	require.Len(t, list, 1)
	accID := list[0].ID

	// Refresh while valid
	refreshed, err := svc.RefreshAccount(accID)
	require.NoError(t, err)
	assert.False(t, refreshed.Quota.AuthExpired)
	require.NotNil(t, refreshed.Quota.Personal)
	require.Len(t, refreshed.Quota.Personal.Cycles, 1)
	assert.Equal(t, 85.0, refreshed.Quota.Personal.Cycles[0].RemainingPercentage)

	// Simulate primary token revoked -> marks AuthExpired=true and returns AUTH_REQUIRED
	expiredMode.Store(true)
	_, err = svc.RefreshAccount(accID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "[AUTH_REQUIRED]")

	listAfterExp, err := svc.ListAccounts()
	require.NoError(t, err)
	require.Len(t, listAfterExp, 1)
	assert.True(t, listAfterExp[0].Quota.AuthExpired)

	// Delete account cleans up both TOML and CredStore
	require.NoError(t, svc.DeleteAccount(accID))
	listAfterDel, err := svc.ListAccounts()
	require.NoError(t, err)
	assert.Empty(t, listAfterDel)
	_, err = credStore.Read(accID)
	assert.ErrorIs(t, err, cred.ErrNotFound)
}
