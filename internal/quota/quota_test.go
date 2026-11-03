package quota

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"codetool/internal/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQuota_FetchCompleteQuota_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer valid-token", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")

		switch r.URL.Path {
		case "/loadCodeAssist":
			_ = json.NewEncoder(w).Encode(LoadProjectResponse{
				ProjectID: "proj-123",
				PaidTier: &Tier{
					ID:   "g1-pro-tier",
					Name: "Pro Tier",
				},
			})
		case "/retrieveUserQuotaSummary":
			frac5h := 0.65
			fracWeek := 0.85
			_ = json.NewEncoder(w).Encode(RawQuotaSummaryResponse{
				Groups: []RawQuotaSummaryGroup{
					{
						DisplayName: "Gemini",
						Buckets: []RawQuotaSummaryBucket{
							{BucketID: "gemini_5h", Window: "5h", RemainingFraction: &frac5h, ResetTime: "2026-11-04T05:00:00Z"},
							{BucketID: "gemini_weekly", Window: "7d", RemainingFraction: &fracWeek, ResetTime: "2026-11-08T00:00:00Z"},
						},
					},
				},
			})
		case "/fetchAvailableModels":
			fracModel := 0.90
			_ = json.NewEncoder(w).Encode(RawQuotaResponse{
				Models: map[string]RawModelInfo{
					"gemini-2.5-flash": {
						DisplayName: "Gemini 2.5 Flash",
						QuotaInfo: &RawQuotaInfo{
							RemainingFraction: &fracModel,
							ResetTime:         "2026-11-04T06:00:00Z",
						},
					},
					"gemini-disabled": {
						DisplayName: "Disabled Model",
						Disabled:    new(bool), // true
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := NewQuotaService(server.Client())
	svc.LoadProjectEndpoints = []string{server.URL + "/loadCodeAssist"}
	svc.QuotaSummaryEndpoints = []string{server.URL + "/retrieveUserQuotaSummary"}
	svc.AvailableModelEndpoints = []string{server.URL + "/fetchAvailableModels"}

	snap, err := svc.FetchCompleteQuota(context.Background(), "valid-token", nil)
	require.NoError(t, err)

	assert.Equal(t, "PRO", snap.SubscriptionTier)
	// Remaining percentage should pick the 5h bucket 65%
	assert.Equal(t, 65, snap.RemainingPercentage)
	assert.Equal(t, "2026-11-04T05:00:00Z", snap.ResetTime)
	assert.False(t, snap.IsForbidden)
	require.Len(t, snap.Groups, 1)
	assert.Equal(t, "Gemini", snap.Groups[0].DisplayName)
	require.Len(t, snap.Groups[0].Buckets, 2)
}

func TestQuota_EndpointFallback(t *testing.T) {
	primaryAttempts := 0
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		primaryAttempts++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer primary.Close()

	secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(LoadProjectResponse{
			ProjectID: "proj-fallback",
			CurrentTier: &Tier{
				ID: "free-tier",
			},
		})
	}))
	defer secondary.Close()

	svc := NewQuotaService(secondary.Client())
	svc.LoadProjectEndpoints = []string{primary.URL, secondary.URL}

	projID, tier, err := svc.FetchProjectAndTier(context.Background(), "test-token")
	require.NoError(t, err)
	assert.Equal(t, "proj-fallback", projID)
	assert.Equal(t, "FREE", tier)
	assert.Equal(t, 1, primaryAttempts)
}

func TestQuota_401Unauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	svc := NewQuotaService(server.Client())
	svc.LoadProjectEndpoints = []string{server.URL}

	_, err := svc.FetchCompleteQuota(context.Background(), "expired-token", nil)
	assert.ErrorIs(t, err, ErrUnauthorized)
}

func TestQuota_403Forbidden(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`Account is restricted`))
	}))
	defer server.Close()

	svc := NewQuotaService(server.Client())
	svc.LoadProjectEndpoints = []string{server.URL}

	last := &storage.QuotaSnapshot{
		SubscriptionTier: "PRO",
		Groups: []storage.QuotaGroup{
			{DisplayName: "OldGroup"},
		},
	}
	snap, err := svc.FetchCompleteQuota(context.Background(), "forbidden-token", last)
	assert.ErrorIs(t, err, ErrForbidden)
	assert.True(t, snap.IsForbidden)
	assert.Contains(t, snap.ErrorMessage, "403")
	assert.Len(t, snap.Groups, 1) // preserved
}
