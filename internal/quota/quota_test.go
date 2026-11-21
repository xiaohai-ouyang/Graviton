package quota

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

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

func TestQuota_StickyPreferredEndpoint(t *testing.T) {
	var primaryHits atomic.Int32
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		primaryHits.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer primary.Close()

	secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/loadCodeAssist":
			_ = json.NewEncoder(w).Encode(LoadProjectResponse{
				ProjectID:   "proj-sticky",
				CurrentTier: &Tier{ID: "pro-tier"},
			})
		case "/retrieveUserQuotaSummary":
			f := 0.8
			_ = json.NewEncoder(w).Encode(RawQuotaSummaryResponse{
				Groups: []RawQuotaSummaryGroup{
					{
						DisplayName: "Gemini",
						Buckets:     []RawQuotaSummaryBucket{{BucketID: "g_5h", Window: "5h", RemainingFraction: &f}},
					},
				},
			})
		case "/fetchAvailableModels":
			_ = json.NewEncoder(w).Encode(RawQuotaResponse{Models: map[string]RawModelInfo{}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer secondary.Close()

	svc := NewQuotaService(secondary.Client())
	svc.LoadProjectEndpoints = []string{primary.URL + "/loadCodeAssist", secondary.URL + "/loadCodeAssist"}
	svc.QuotaSummaryEndpoints = []string{primary.URL + "/retrieveUserQuotaSummary", secondary.URL + "/retrieveUserQuotaSummary"}
	svc.AvailableModelEndpoints = []string{primary.URL + "/fetchAvailableModels", secondary.URL + "/fetchAvailableModels"}

	// First call hits primary once on loadCodeAssist, falls back to secondary, and reuses secondary host for summary & models.
	snap1, err := svc.FetchCompleteQuota(context.Background(), "tok", nil)
	require.NoError(t, err)
	assert.Equal(t, 80, snap1.RemainingPercentage)
	assert.Equal(t, int32(1), primaryHits.Load())

	// Second call should go straight to secondary for all 3 APIs without hitting primary again.
	snap2, err := svc.FetchCompleteQuota(context.Background(), "tok", nil)
	require.NoError(t, err)
	assert.Equal(t, 80, snap2.RemainingPercentage)
	assert.Equal(t, int32(1), primaryHits.Load())
}

func TestQuota_ParallelSummaryAndModels(t *testing.T) {
	bothArrived := make(chan struct{})
	var waiting atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/loadCodeAssist":
			_ = json.NewEncoder(w).Encode(LoadProjectResponse{
				ProjectID:   "proj-par",
				CurrentTier: &Tier{ID: "free-tier"},
			})
		case "/retrieveUserQuotaSummary", "/fetchAvailableModels":
			if waiting.Add(1) == 2 {
				close(bothArrived)
			}
			select {
			case <-bothArrived:
			case <-time.After(2 * time.Second):
				w.WriteHeader(http.StatusGatewayTimeout)
				return
			}
			if r.URL.Path == "/retrieveUserQuotaSummary" {
				f := 0.5
				_ = json.NewEncoder(w).Encode(RawQuotaSummaryResponse{
					Groups: []RawQuotaSummaryGroup{
						{
							DisplayName: "Claude",
							Buckets:     []RawQuotaSummaryBucket{{BucketID: "c_5h", Window: "5h", RemainingFraction: &f}},
						},
					},
				})
			} else {
				_ = json.NewEncoder(w).Encode(RawQuotaResponse{Models: map[string]RawModelInfo{}})
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := NewQuotaService(server.Client())
	svc.LoadProjectEndpoints = []string{server.URL + "/loadCodeAssist"}
	svc.QuotaSummaryEndpoints = []string{server.URL + "/retrieveUserQuotaSummary"}
	svc.AvailableModelEndpoints = []string{server.URL + "/fetchAvailableModels"}

	snap, err := svc.FetchCompleteQuota(context.Background(), "tok", nil)
	require.NoError(t, err)
	assert.Equal(t, 50, snap.RemainingPercentage)
}

func TestQuota_AttemptTimeoutFallsBack(t *testing.T) {
	unblockSlow := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-unblockSlow:
		case <-r.Context().Done():
		}
	}))
	defer func() {
		close(unblockSlow)
		slow.Close()
	}()

	fast := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(LoadProjectResponse{
			ProjectID:   "proj-fast",
			CurrentTier: &Tier{ID: "pro-tier"},
		})
	}))
	defer fast.Close()

	svc := NewQuotaService(fast.Client())
	svc.AttemptTimeout = 120 * time.Millisecond
	svc.LoadProjectEndpoints = []string{slow.URL, fast.URL}

	start := time.Now()
	projID, tier, err := svc.FetchProjectAndTier(context.Background(), "tok")
	elapsed := time.Since(start)

	require.NoError(t, err)
	assert.Equal(t, "proj-fast", projID)
	assert.Equal(t, "PRO", tier)
	assert.Less(t, elapsed, time.Second)
}
