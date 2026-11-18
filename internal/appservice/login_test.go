package appservice

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"codetool/internal/cred"
	"codetool/internal/oauth"
	"codetool/internal/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseRefreshTokenInputs(t *testing.T) {
	t.Run("single token", func(t *testing.T) {
		items, err := ParseRefreshTokenInputs("  1//0abc1234567890xyz  ")
		require.NoError(t, err)
		require.Len(t, items, 1)
		assert.Equal(t, "1//0abc1234567890xyz", items[0].RefreshToken)
	})

	t.Run("multi-line with comments and email prefix", func(t *testing.T) {
		raw := `
# comment line
1//0tokenOne
alice@example.com|1//0tokenTwo
bob@example.com,1//0tokenThree
1//0tokenOne
`
		items, err := ParseRefreshTokenInputs(raw)
		require.NoError(t, err)
		require.Len(t, items, 3)
		assert.Equal(t, "1//0tokenOne", items[0].RefreshToken)
		assert.Equal(t, "alice@example.com", items[1].Label)
		assert.Equal(t, "1//0tokenTwo", items[1].RefreshToken)
		assert.Equal(t, "bob@example.com", items[2].Label)
		assert.Equal(t, "1//0tokenThree", items[2].RefreshToken)
	})

	t.Run("antigravity manager json array", func(t *testing.T) {
		raw := `[
			{"email": "a@example.com", "refresh_token": "1//0aaa"},
			{"email": "b@example.com", "token": {"refresh_token": "1//0bbb"}}
		]`
		items, err := ParseRefreshTokenInputs(raw)
		require.NoError(t, err)
		require.Len(t, items, 2)
		assert.Equal(t, "a@example.com", items[0].Label)
		assert.Equal(t, "1//0aaa", items[0].RefreshToken)
		assert.Equal(t, "b@example.com", items[1].Label)
		assert.Equal(t, "1//0bbb", items[1].RefreshToken)
	})

	t.Run("single json object", func(t *testing.T) {
		raw := `{"email": "single@example.com", "refreshToken": "1//0single"}`
		items, err := ParseRefreshTokenInputs(raw)
		require.NoError(t, err)
		require.Len(t, items, 1)
		assert.Equal(t, "single@example.com", items[0].Label)
		assert.Equal(t, "1//0single", items[0].RefreshToken)
	})

	t.Run("empty input", func(t *testing.T) {
		_, err := ParseRefreshTokenInputs("   ")
		assert.Error(t, err)
	})
}

func newMockOAuthAndQuotaServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/token":
			_ = r.ParseForm()
			if r.Form.Get("refresh_token") == "1//0bad" {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
				return
			}
			_ = json.NewEncoder(w).Encode(oauth.RefreshTokenResponse{
				AccessToken:  "mock-access-token",
				RefreshToken: "1//0good-refresh",
				ExpiresIn:    3600,
				TokenType:    "Bearer",
			})
		case "/userinfo":
			_ = json.NewEncoder(w).Encode(oauth.UserInfo{
				Email: "oauth-user@example.com",
				Name:  "OAuth User",
			})
		default:
			// Quota endpoints return 404 or empty so FetchCompleteQuota falls back gracefully
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func TestAppService_ImportRefreshTokens(t *testing.T) {
	server := newMockOAuthAndQuotaServer(t)
	defer server.Close()

	sm, err := storage.NewStorageManager(t.TempDir())
	require.NoError(t, err)

	svc := NewAppService(sm, server.Client())
	svc.oauthSvc.TokenURL = server.URL + "/token"
	svc.oauthSvc.UserInfoURL = server.URL + "/userinfo"

	res, err := svc.ImportRefreshTokens("1//0good\n1//0bad")
	require.NoError(t, err)
	assert.Equal(t, 2, res.Total)
	assert.Equal(t, 1, res.Success)
	assert.Equal(t, 1, res.Failed)
	require.Len(t, res.Results, 2)
	assert.True(t, res.Results[0].Success)
	require.NotNil(t, res.Results[0].Account)
	assert.Equal(t, "oauth-user@example.com", res.Results[0].Account.Email)
	defer func() { _ = cred.DeleteAccountCredential(res.Results[0].Account.ID) }()

	assert.False(t, res.Results[1].Success)
	assert.Contains(t, res.Results[1].Error, "invalid_grant")
}

func TestAppService_OAuthCallbackFlow(t *testing.T) {
	server := newMockOAuthAndQuotaServer(t)
	defer server.Close()

	sm, err := storage.NewStorageManager(t.TempDir())
	require.NoError(t, err)

	svc := NewAppService(sm, server.Client())
	svc.oauthSvc.TokenURL = server.URL + "/token"
	svc.oauthSvc.UserInfoURL = server.URL + "/userinfo"

	doneCh := make(chan OAuthCompletionEvent, 1)
	startRes, err := svc.StartOAuthLogin(func(evt OAuthCompletionEvent) {
		doneCh <- evt
	})
	require.NoError(t, err)
	assert.NotEmpty(t, startRes.AuthURL)
	assert.NotEmpty(t, startRes.State)
	assert.Contains(t, startRes.RedirectURI, "/oauth-callback")

	callbackURL := fmt.Sprintf("%s?code=test-auth-code&state=%s", startRes.RedirectURI, startRes.State)
	resp, err := http.Get(callbackURL)
	require.NoError(t, err)
	_ = resp.Body.Close()
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	select {
	case evt := <-doneCh:
		require.Empty(t, evt.Error)
		require.NotNil(t, evt.Account)
		assert.Equal(t, "oauth-user@example.com", evt.Account.Email)
		_ = cred.DeleteAccountCredential(evt.Account.ID)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for OAuth completion event")
	}
}

func TestAppService_CompleteOAuthWithCallbackURL(t *testing.T) {
	server := newMockOAuthAndQuotaServer(t)
	defer server.Close()

	sm, err := storage.NewStorageManager(t.TempDir())
	require.NoError(t, err)

	svc := NewAppService(sm, server.Client())
	svc.oauthSvc.TokenURL = server.URL + "/token"
	svc.oauthSvc.UserInfoURL = server.URL + "/userinfo"

	startRes, err := svc.StartOAuthLogin(nil)
	require.NoError(t, err)
	defer svc.CancelOAuthLogin()

	pastedURL := fmt.Sprintf("%s?code=manual-code&state=%s", startRes.RedirectURI, startRes.State)
	acc, err := svc.CompleteOAuthWithCallbackURL(pastedURL)
	require.NoError(t, err)
	require.NotNil(t, acc)
	assert.Equal(t, "oauth-user@example.com", acc.Email)
	_ = cred.DeleteAccountCredential(acc.ID)
}
