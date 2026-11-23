package deepseek

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClient_FetchBalance_Success(t *testing.T) {
	var gotAuth string
	var gotPath string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"is_available": true,
			"balance_infos": [
				{
					"currency": "CNY",
					"total_balance": "110.00",
					"granted_balance": "10.00",
					"topped_up_balance": "100.00"
				},
				{
					"currency": "usd",
					"total_balance": "5.50",
					"granted_balance": "0.50",
					"topped_up_balance": "5.00"
				}
			]
		}`))
	}))
	defer srv.Close()

	c := NewClient(srv.Client())
	c.baseURL = srv.URL
	fixedNow := time.Date(2026, 11, 23, 9, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return fixedNow }

	snap, err := c.FetchBalance(context.Background(), "sk-test-key-1234")
	require.NoError(t, err)
	assert.Equal(t, "/user/balance", gotPath)
	assert.Equal(t, "Bearer sk-test-key-1234", gotAuth)
	assert.True(t, snap.IsAvailable)
	assert.False(t, snap.AuthInvalid)
	assert.Empty(t, snap.ErrorMessage)
	assert.Equal(t, "2026-11-23T09:00:00Z", snap.LastRefreshedAt)
	require.Len(t, snap.BalanceInfos, 2)
	assert.Equal(t, "CNY", snap.BalanceInfos[0].Currency)
	assert.Equal(t, "110.00", snap.BalanceInfos[0].TotalBalance)
	assert.Equal(t, "10.00", snap.BalanceInfos[0].GrantedBalance)
	assert.Equal(t, "100.00", snap.BalanceInfos[0].ToppedUpBalance)
	assert.Equal(t, "USD", snap.BalanceInfos[1].Currency)
	assert.Equal(t, "5.50", snap.BalanceInfos[1].TotalBalance)
}

func TestClient_FetchBalance_AuthInvalid(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"error":{"message":"Authentication Fails"}}`))
		}))
		c := NewClient(srv.Client())
		c.baseURL = srv.URL

		_, err := c.FetchBalance(context.Background(), "sk-bad-key")
		srv.Close()
		assert.ErrorIs(t, err, ErrAuthInvalid)
	}
}

func TestClient_FetchBalance_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"message":"service temporarily unavailable"}}`))
	}))
	defer srv.Close()

	c := NewClient(srv.Client())
	c.baseURL = srv.URL

	_, err := c.FetchBalance(context.Background(), "sk-valid-key")
	require.Error(t, err)
	assert.NotErrorIs(t, err, ErrAuthInvalid)
	assert.Contains(t, err.Error(), "HTTP 500")
	assert.Contains(t, err.Error(), "service temporarily unavailable")
}
