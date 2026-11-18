package oauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"codetool/internal/cred"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOAuth_UserInfo(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer test-access-token", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(UserInfo{
			Email:      "alice@example.com",
			Name:       "Alice Smith",
			GivenName:  "Alice",
			FamilyName: "Smith",
		})
	}))
	defer server.Close()

	svc := NewOAuthService(server.Client())
	svc.UserInfoURL = server.URL

	info, err := svc.FetchUserInfo(context.Background(), "test-access-token")
	require.NoError(t, err)
	assert.Equal(t, "alice@example.com", info.Email)
	assert.Equal(t, "Alice Smith", info.GetDisplayName())
}

func TestOAuth_RefreshToken_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := r.ParseForm()
		assert.NoError(t, err)
		assert.Equal(t, "refresh_token", r.Form.Get("grant_type"))
		assert.Equal(t, "my-refresh-token", r.Form.Get("refresh_token"))

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(RefreshTokenResponse{
			AccessToken: "new-access-token",
			ExpiresIn:   3600,
			TokenType:   "Bearer",
		})
	}))
	defer server.Close()

	svc := NewOAuthService(server.Client())
	svc.TokenURL = server.URL

	resp, err := svc.RefreshToken(context.Background(), "my-refresh-token")
	require.NoError(t, err)
	assert.Equal(t, "new-access-token", resp.AccessToken)
	assert.Equal(t, int64(3600), resp.ExpiresIn)
}

func TestOAuth_RefreshToken_InvalidGrant(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error": "invalid_grant", "error_description": "Token has been expired or revoked."}`))
	}))
	defer server.Close()

	svc := NewOAuthService(server.Client())
	svc.TokenURL = server.URL

	_, err := svc.RefreshToken(context.Background(), "revoked-token")
	assert.ErrorIs(t, err, ErrInvalidGrant)
}

func TestOAuth_EnsureFreshToken(t *testing.T) {
	refreshCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		refreshCalls++
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(RefreshTokenResponse{
			AccessToken: "refreshed-token",
			ExpiresIn:   3600,
			TokenType:   "Bearer",
		})
	}))
	defer server.Close()

	svc := NewOAuthService(server.Client())
	svc.TokenURL = server.URL

	// 1. Token valid for 1 hour -> should NOT refresh
	payload := &cred.CredentialPayload{
		Token: cred.TokenInfo{
			AccessToken:  "old-token",
			RefreshToken: "rt-123",
			Expiry:       time.Now().Add(1 * time.Hour).Format(time.RFC3339),
			ExpiresIn:    3600,
		},
	}
	updated, wasRefreshed, err := svc.EnsureFreshToken(context.Background(), payload, false)
	require.NoError(t, err)
	assert.False(t, wasRefreshed)
	assert.Equal(t, "old-token", updated.Token.AccessToken)
	assert.Equal(t, 0, refreshCalls)

	// 2. Token expiring in 2 minutes (less than 5 min skew) -> should refresh
	payload.Token.Expiry = time.Now().Add(2 * time.Minute).Format(time.RFC3339)
	updated, wasRefreshed, err = svc.EnsureFreshToken(context.Background(), payload, false)
	require.NoError(t, err)
	assert.True(t, wasRefreshed)
	assert.Equal(t, "refreshed-token", updated.Token.AccessToken)
	assert.Equal(t, 1, refreshCalls)

	// 3. Token valid for 1 hour but force=true -> should refresh
	updated, wasRefreshed, err = svc.EnsureFreshToken(context.Background(), updated, true)
	require.NoError(t, err)
	assert.True(t, wasRefreshed)
	assert.Equal(t, 2, refreshCalls)
}

func TestOAuth_BuildAuthURL(t *testing.T) {
	svc := NewOAuthService(nil)
	authURL := svc.BuildAuthURL("http://127.0.0.1:54321/oauth-callback", "state-xyz")
	assert.Contains(t, authURL, AuthEndpoint)
	assert.Contains(t, authURL, "client_id="+DefaultClientID)
	assert.Contains(t, authURL, "redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2Foauth-callback")
	assert.Contains(t, authURL, "state=state-xyz")
	assert.Contains(t, authURL, "access_type=offline")
	assert.Contains(t, authURL, "prompt=consent")
	assert.Contains(t, authURL, "response_type=code")
}

func TestOAuth_ExchangeCode_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := r.ParseForm()
		assert.NoError(t, err)
		assert.Equal(t, "authorization_code", r.Form.Get("grant_type"))
		assert.Equal(t, "auth-code-123", r.Form.Get("code"))
		assert.Equal(t, "http://127.0.0.1:9999/oauth-callback", r.Form.Get("redirect_uri"))

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(RefreshTokenResponse{
			AccessToken:  "exchanged-access",
			RefreshToken: "exchanged-refresh",
			ExpiresIn:    3600,
			TokenType:    "Bearer",
		})
	}))
	defer server.Close()

	svc := NewOAuthService(server.Client())
	svc.TokenURL = server.URL

	resp, err := svc.ExchangeCode(context.Background(), "auth-code-123", "http://127.0.0.1:9999/oauth-callback")
	require.NoError(t, err)
	assert.Equal(t, "exchanged-access", resp.AccessToken)
	assert.Equal(t, "exchanged-refresh", resp.RefreshToken)
}

func TestOAuth_BuildCredentialPayload(t *testing.T) {
	payload := BuildCredentialPayload(&RefreshTokenResponse{
		AccessToken: "at-1",
		ExpiresIn:   3600,
		TokenType:   "",
	}, "fallback-rt")
	assert.Equal(t, "consumer", payload.AuthMethod)
	assert.Equal(t, "Bearer", payload.Token.TokenType)
	assert.Equal(t, "fallback-rt", payload.Token.RefreshToken)
	assert.NotEmpty(t, payload.Token.Expiry)
}
