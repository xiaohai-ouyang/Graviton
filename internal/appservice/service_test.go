package appservice

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"graviton/internal/cred"
	"graviton/internal/quota"
	"graviton/internal/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAppService_ListAccounts_Empty(t *testing.T) {
	tempDir := t.TempDir()
	sm, err := storage.NewStorageManager(tempDir)
	require.NoError(t, err)

	svc := NewAppService(sm, nil)
	list, err := svc.ListAccounts()
	require.NoError(t, err)
	assert.Empty(t, list)
}

func TestAppService_DeleteAccount(t *testing.T) {
	tempDir := t.TempDir()
	sm, err := storage.NewStorageManager(tempDir)
	require.NoError(t, err)

	// Setup fake account
	accountID := "del-test-123"
	err = sm.SaveAccounts([]storage.AccountRecord{
		{
			ID:    accountID,
			Email: "del@example.com",
			Name:  "Delete Me",
		},
	})
	require.NoError(t, err)

	// Save fake credential
	_ = cred.WriteAccountCredential(accountID, &cred.CredentialPayload{
		Token: cred.TokenInfo{
			RefreshToken: "rt-123",
		},
		IDTokenEmail: "del@example.com",
	})
	defer func() { _ = cred.DeleteAccountCredential(accountID) }()

	svc := NewAppService(sm, nil)

	// Delete
	err = svc.DeleteAccount(accountID)
	require.NoError(t, err)

	// Verify account removed from storage
	remaining, _, err := sm.LoadAccounts()
	require.NoError(t, err)
	assert.Empty(t, remaining)

	// Verify credential deleted
	_, err = cred.ReadAccountCredential(accountID)
	assert.ErrorIs(t, err, cred.ErrNotFound)
}

func TestAppService_LockBusy(t *testing.T) {
	tempDir := t.TempDir()
	sm, err := storage.NewStorageManager(tempDir)
	require.NoError(t, err)

	svc := NewAppService(sm, nil)

	// Manually hold lock
	svc.opLock.Lock()

	// Another operation should immediately return BUSY
	_, err = svc.CaptureCurrentAccount()
	require.Error(t, err)
	var appErr *AppError
	require.True(t, errorsAs(err, &appErr))
	assert.Equal(t, "BUSY", appErr.Code)

	svc.opLock.Unlock()
}

func errorsAs(err error, target **AppError) bool {
	if e, ok := err.(*AppError); ok {
		*target = e
		return true
	}
	return false
}

func TestAppService_RefreshAllQuotas(t *testing.T) {
	tempDir := t.TempDir()
	sm, err := storage.NewStorageManager(tempDir)
	require.NoError(t, err)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/loadCodeAssist":
			_ = json.NewEncoder(w).Encode(quota.LoadProjectResponse{
				ProjectID: "proj-batch",
				PaidTier:  &quota.Tier{ID: "pro-tier"},
			})
		case "/retrieveUserQuotaSummary":
			f := 0.75
			_ = json.NewEncoder(w).Encode(quota.RawQuotaSummaryResponse{
				Groups: []quota.RawQuotaSummaryGroup{
					{
						DisplayName: "Gemini",
						Buckets: []quota.RawQuotaSummaryBucket{
							{BucketID: "gemini_5h", Window: "5h", RemainingFraction: &f, ResetTime: "2026-11-04T08:00:00Z"},
						},
					},
				},
			})
		case "/fetchAvailableModels":
			_ = json.NewEncoder(w).Encode(quota.RawQuotaResponse{
				Models: map[string]quota.RawModelInfo{},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := NewAppService(sm, server.Client())
	svc.quotaSvc.LoadProjectEndpoints = []string{server.URL + "/loadCodeAssist"}
	svc.quotaSvc.QuotaSummaryEndpoints = []string{server.URL + "/retrieveUserQuotaSummary"}
	svc.quotaSvc.AvailableModelEndpoints = []string{server.URL + "/fetchAvailableModels"}

	// Create 3 accounts
	for i := 1; i <= 3; i++ {
		id := "batch-acc-" + string(rune('0'+i))
		_ = sm.SaveAccounts(append(getAccounts(sm), storage.AccountRecord{
			ID:        id,
			Email:     "user" + string(rune('0'+i)) + "@gmail.com",
			Name:      "User " + string(rune('0'+i)),
			CreatedAt: time.Now().Format(time.RFC3339),
		}))
		_ = cred.WriteAccountCredential(id, &cred.CredentialPayload{
			Token: cred.TokenInfo{
				AccessToken:  "valid-token",
				RefreshToken: "rt-" + string(rune('0'+i)),
				Expiry:       time.Now().Add(1 * time.Hour).Format(time.RFC3339),
				ExpiresIn:    3600,
			},
			IDTokenEmail: "user" + string(rune('0'+i)) + "@gmail.com",
		})
		defer func(accID string) { _ = cred.DeleteAccountCredential(accID) }(id)
	}

	results, err := svc.RefreshAllQuotas()
	require.NoError(t, err)
	require.Len(t, results, 3)

	for _, res := range results {
		assert.True(t, res.Success)
		assert.Equal(t, "PRO", res.Account.SubscriptionTier)
		assert.Equal(t, 75, res.Account.RemainingPercentage)
	}

	progressIDs := make(chan string, 3)
	results2, err := svc.RefreshAllQuotasWithProgress(func(r BatchRefreshResult) {
		progressIDs <- r.AccountID
	})
	require.NoError(t, err)
	require.Len(t, results2, 3)
	close(progressIDs)

	seen := make(map[string]bool)
	for id := range progressIDs {
		seen[id] = true
	}
	assert.Len(t, seen, 3)
}

func getAccounts(sm *storage.StorageManager) []storage.AccountRecord {
	accs, _, _ := sm.LoadAccounts()
	return accs
}
