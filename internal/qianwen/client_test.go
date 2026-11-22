package qianwen

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"graviton/internal/cred"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGeneratePKCE(t *testing.T) {
	pkce, err := GeneratePKCE()
	require.NoError(t, err)

	assert.Equal(t, "S256", pkce.CodeChallengeMethod)
	assert.NotContains(t, pkce.CodeVerifier, "=")
	assert.NotContains(t, pkce.CodeChallenge, "=")
	assert.Len(t, pkce.CodeVerifier, 43) // 32 bytes base64url without padding

	rawVerifier, err := base64.RawURLEncoding.DecodeString(pkce.CodeVerifier)
	require.NoError(t, err)
	assert.Len(t, rawVerifier, 32)

	sum := sha256.Sum256([]byte(pkce.CodeVerifier))
	expectedChallenge := base64.RawURLEncoding.EncodeToString(sum[:])
	assert.Equal(t, expectedChallenge, pkce.CodeChallenge)
}

func TestStartDeviceAuth_And_PollStateMachine(t *testing.T) {
	var pollStep atomic.Int32
	var capturedChallenge string
	var capturedVerifier string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, DefaultUserAgent, r.Header.Get("User-Agent"))
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/cli/device/code":
			assert.Equal(t, http.MethodPost, r.Method)
			q := r.URL.Query()
			assert.Equal(t, "client-uuid-1", q.Get("client_id"))
			assert.Equal(t, "S256", q.Get("code_challenge_method"))
			capturedChallenge = q.Get("code_challenge")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Success": true,
				"Data": map[string]any{
					"Token":           "dev-tok-123",
					"VerificationUrl": "https://t.qianwenai.com/verify?code=XYZ",
					"ExpiresIn":       120,
					"Interval":        2,
				},
			})
		case "/cli/device/token":
			q := r.URL.Query()
			assert.Equal(t, "client-uuid-1", q.Get("client_id"))
			assert.Equal(t, "dev-tok-123", q.Get("token"))
			capturedVerifier = q.Get("code_verifier")

			step := pollStep.Add(1)
			switch step {
			case 1:
				_ = json.NewEncoder(w).Encode(map[string]any{
					"Data": map[string]any{"Status": "authorization_pending"},
				})
			case 2:
				_ = json.NewEncoder(w).Encode(map[string]any{
					"Data": map[string]any{"Status": "slow_down"},
				})
			default:
				_ = json.NewEncoder(w).Encode(map[string]any{
					"Data": map[string]any{
						"Status": "complete",
						"Credentials": map[string]any{
							"AccessToken": "primary-access-tok",
							"ExpireTime":  "2026-12-31T00:00:00Z",
							"User": map[string]any{
								"Id":       "u-1",
								"Email":    "dev@example.com",
								"AliyunId": "ali-999",
							},
						},
					},
				})
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	now := time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC)
	var sleeps []time.Duration
	c := NewClient(srv.Client())
	c.AuthEndpoint = srv.URL
	c.Now = func() time.Time { return now }
	c.Sleep = func(ctx context.Context, d time.Duration) error {
		sleeps = append(sleeps, d)
		now = now.Add(d)
		return nil
	}

	start, err := c.StartDeviceAuth(context.Background(), "client-uuid-1")
	require.NoError(t, err)
	assert.Equal(t, "dev-tok-123", start.DeviceCode)
	assert.Equal(t, 2, start.Interval)
	assert.NotEmpty(t, start.CodeVerifier)
	assert.NotEmpty(t, capturedChallenge)

	var statuses []string
	var slowInterval int
	creds, err := c.PollDeviceToken(context.Background(), start, func(status string, interval int) {
		statuses = append(statuses, status)
		if status == "slow_down" {
			slowInterval = interval
		}
	})
	require.NoError(t, err)
	assert.Equal(t, "primary-access-tok", creds.AccessToken)
	assert.Equal(t, "ali-999", creds.User.AliyunID)
	assert.Equal(t, start.CodeVerifier, capturedVerifier)
	assert.Equal(t, []string{"pending", "slow_down"}, statuses)
	assert.Equal(t, 7, slowInterval)
	// First two sleeps at initial interval 2s, third sleep after slow_down at 7s
	assert.Equal(t, []time.Duration{2 * time.Second, 2 * time.Second, 7 * time.Second}, sleeps)
}

func TestPollDeviceToken_ErrorsAndCancellation(t *testing.T) {
	t.Run("timeout", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Data": map[string]any{"Status": "authorization_pending"},
			})
		}))
		defer srv.Close()

		now := time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC)
		c := NewClient(srv.Client())
		c.AuthEndpoint = srv.URL
		c.Now = func() time.Time { return now }
		c.Sleep = func(ctx context.Context, d time.Duration) error {
			now = now.Add(d)
			return nil
		}

		_, err := c.PollDeviceToken(context.Background(), &DeviceAuthStart{
			ClientID:   "cid",
			DeviceCode: "dc",
			ExpiresIn:  10,
			Interval:   4,
		}, nil)
		assert.ErrorIs(t, err, ErrDeviceExpired)
	})

	t.Run("expired_and_denied", func(t *testing.T) {
		for _, tc := range []struct {
			status  string
			wantErr error
		}{
			{"expired_token", ErrDeviceExpired},
			{"access_denied", ErrAccessDenied},
		} {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{
					"Data": map[string]any{"Status": tc.status},
				})
			}))
			now := time.Now()
			c := NewClient(srv.Client())
			c.AuthEndpoint = srv.URL
			c.Now = func() time.Time { return now }
			c.Sleep = func(ctx context.Context, d time.Duration) error {
				now = now.Add(d)
				return nil
			}
			_, err := c.PollDeviceToken(context.Background(), &DeviceAuthStart{
				ClientID:   "cid",
				DeviceCode: "dc",
				ExpiresIn:  30,
				Interval:   1,
			}, nil)
			srv.Close()
			assert.ErrorIs(t, err, tc.wantErr)
		}
	})

	t.Run("cancelled", func(t *testing.T) {
		c := NewClient(nil)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := c.PollDeviceToken(ctx, &DeviceAuthStart{
			ClientID:   "cid",
			DeviceCode: "dc",
			ExpiresIn:  30,
			Interval:   5,
		}, nil)
		assert.ErrorIs(t, err, context.Canceled)
	})
}

func TestFetchTokenPlanUsage_DerivedRefreshAndFullParse(t *testing.T) {
	var generateCalls atomic.Int32
	var mu sync.Mutex
	var authHeadersSeen []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/data/v2/api.json":
			assert.Equal(t, "Bearer primary-tok", r.Header.Get("Authorization"))
			var req struct {
				Product string         `json:"product"`
				Action  string         `json:"action"`
				Params  map[string]any `json:"params"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
			switch req.Action {
			case ActionGenerateCLIAccessToken:
				n := generateCalls.Add(1)
				tok := "derived-tok-fresh"
				if n > 1 {
					tok = "derived-tok-renewed"
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code":            "200",
					"successResponse": true,
					"data": map[string]any{
						"cliAccessToken": tok,
					},
				})
			case ActionDescribeFrInstances:
				if req.Params["CommodityCode"] == CommodityTeamAddon {
					_ = json.NewEncoder(w).Encode(map[string]any{
						"code": "200",
						"data": map[string]any{
							"Data": []map[string]any{
								{"Status": "valid", "CurrCapacityBaseValue": "50"},
							},
						},
					})
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code": "200",
					"data": map[string]any{
						"Data": []map[string]any{
							{
								"InstanceId":            "team-inst-1",
								"CommodityCode":         CommodityTeam,
								"TemplateName":          "团队旗舰版",
								"Status":                "valid",
								"InitCapacityBaseValue": "1000",
								"CurrCapacityBaseValue": "600",
							},
						},
					},
				})
			case ActionGetSeatSummary:
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code": "200",
					"data": map[string]any{
						"Data": map[string]any{
							"PlanName":      "团队旗舰版",
							"StartTime":     "2026-11-01T00:00:00Z",
							"EndTime":       "2026-12-01T00:00:00Z",
							"RemainingDays": 9,
							"SubscriptionGroupList": []map[string]any{
								{
									"SpecType":                   "pro",
									"SubscriptionTotalNumber":    5,
									"SubscriptionAssignedNumber": 4,
									"NextCycleFlushTime":         "2026-12-01T00:00:00Z",
									"EquityList": []map[string]any{
										{"EquityType": "CREDITS", "TotalValue": "1000", "SurplusValue": "600"},
									},
								},
							},
						},
					},
				})
			case ActionCheckTeamAutoRenewal:
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code": "200",
					"data": map[string]any{
						"Data": map[string]any{"AutoRenewal": true},
					},
				})
			}

		case "/cli/api.json":
			auth := r.Header.Get("Authorization")
			mu.Lock()
			authHeadersSeen = append(authHeadersSeen, auth)
			mu.Unlock()

			// Simulate stale derived token triggering BailianGateway.Login.NotLogined -> auto refresh + retry
			if auth == "Bearer stale-derived-tok" {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code":            "200",
					"successResponse": true,
					"data": map[string]any{
						"success":   false,
						"errorCode": "BailianGateway.Login.NotLogined",
					},
				})
				return
			}

			apiName := r.URL.Query().Get("api")
			var innerData map[string]any
			switch apiName {
			case APIPersonalSubscription:
				innerData = map[string]any{
					"code":    "SUCCESS",
					"success": true,
					"data": map[string]any{
						"status":        "VALID",
						"instanceCode":  "pers-inst-1",
						"specCode":      "pro",
						"remainingDays": 12,
						"startTime":     float64(1793491200000),
						"endTime":       float64(1796083200000),
						"autoRenewFlag": true,
					},
				}
			case APIPersonalUsage:
				innerData = map[string]any{
					"code":    "SUCCESS",
					"success": true,
					"data": map[string]any{
						"per5HourPercentage":  0.2,
						"per5HourResetTime":   float64(1795000000000),
						"per1WeekPercentage":  0.35,
						"per1WeekResetTime":   float64(1795500000000),
						"per1MonthPercentage": 0.4,
						"per1MonthResetTime":  float64(1796083200000),
					},
				}
			case APIPersonalQuotaConfig:
				innerData = map[string]any{
					"code":    "SUCCESS",
					"success": true,
					"data": map[string]any{
						"pro": map[string]any{
							"fiveHour": 1200,
							"weekly":   4500,
							"monthly":  18000,
						},
					},
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":            "200",
				"successResponse": true,
				"data": map[string]any{
					"success":   true,
					"errorCode": "",
					"DataV2": map[string]any{
						"ret":  []string{"SUCCESS::调用成功"},
						"data": innerData,
					},
				},
			})
		}
	}))
	defer srv.Close()

	c := NewClient(srv.Client())
	c.APIEndpoint = srv.URL
	c.CSDataEndpoint = srv.URL

	creds := &cred.QianwenCredentialPayload{
		AccessToken:    "primary-tok",
		ExpiresAt:      time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
		CLIAccessToken: "stale-derived-tok",
	}

	var updatedToken string
	snap, err := c.FetchTokenPlanUsage(context.Background(), creds, func(p *cred.QianwenCredentialPayload) {
		updatedToken = p.CLIAccessToken
	})
	require.NoError(t, err)
	assert.Equal(t, int32(1), generateCalls.Load(), "should refresh derived token once across concurrent cs-data calls")
	assert.Equal(t, "derived-tok-fresh", updatedToken)
	assert.True(t, snap.HasSubscription)

	require.NotNil(t, snap.Personal)
	assert.Equal(t, "active", snap.Personal.Status)
	assert.Equal(t, "Pro", snap.Personal.PlanName)
	assert.Equal(t, 12, snap.Personal.RemainingDays)
	assert.True(t, snap.Personal.AutoRenew)
	require.Len(t, snap.Personal.Cycles, 3)

	assert.Equal(t, "5h", snap.Personal.Cycles[0].Cycle)
	assert.Equal(t, 20.0, snap.Personal.Cycles[0].UsedPercentage)
	assert.Equal(t, 80.0, snap.Personal.Cycles[0].RemainingPercentage)
	require.NotNil(t, snap.Personal.Cycles[0].TotalQuota)
	assert.Equal(t, 1200.0, *snap.Personal.Cycles[0].TotalQuota)

	assert.Equal(t, "weekly", snap.Personal.Cycles[1].Cycle)
	assert.Equal(t, 35.0, snap.Personal.Cycles[1].UsedPercentage)
	assert.Equal(t, 65.0, snap.Personal.Cycles[1].RemainingPercentage)

	assert.Equal(t, "monthly", snap.Personal.Cycles[2].Cycle)
	assert.Equal(t, 40.0, snap.Personal.Cycles[2].UsedPercentage)
	assert.Equal(t, 60.0, snap.Personal.Cycles[2].RemainingPercentage)

	require.NotNil(t, snap.Team)
	assert.Equal(t, "active", snap.Team.Status)
	assert.Equal(t, "团队旗舰版", snap.Team.PlanName)
	assert.Equal(t, 1000.0, snap.Team.TotalCredits)
	assert.Equal(t, 600.0, snap.Team.RemainingCredits)
	assert.Equal(t, 60.0, snap.Team.RemainingPercentage)
	assert.Equal(t, 50.0, snap.Team.AddonRemaining)
	require.NotNil(t, snap.Team.AutoRenew)
	assert.True(t, *snap.Team.AutoRenew)
}

func TestFetchTokenPlanUsage_NoSubscriptionAndAuthExpired(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/data/v2/api.json" {
			var req struct {
				Action string `json:"action"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			if req.Action == ActionGenerateCLIAccessToken {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"code":            "200",
					"successResponse": true,
					"data":            map[string]any{"cliAccessToken": "derived-ok"},
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": "200",
				"data": map[string]any{"Data": []any{}},
			})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/cli/api.json") {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":            "200",
				"successResponse": true,
				"data": map[string]any{
					"success":   true,
					"errorCode": "",
					"DataV2": map[string]any{
						"ret": []string{"SUCCESS::ok"},
						"data": map[string]any{
							"code":    "SUCCESS",
							"success": true,
						},
					},
				},
			})
		}
	}))
	defer srv.Close()

	c := NewClient(srv.Client())
	c.APIEndpoint = srv.URL
	c.CSDataEndpoint = srv.URL

	snap, err := c.FetchTokenPlanUsage(context.Background(), &cred.QianwenCredentialPayload{
		AccessToken: "valid-primary",
		ExpiresAt:   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	}, nil)
	require.NoError(t, err)
	assert.False(t, snap.HasSubscription)
	require.NotNil(t, snap.Personal)
	assert.Equal(t, "not_subscribed", snap.Personal.Status)
	require.NotNil(t, snap.Team)
	assert.Equal(t, "not_subscribed", snap.Team.Status)

	// Expired primary token returns ErrAuthRequired without making network requests.
	_, err = c.FetchTokenPlanUsage(context.Background(), &cred.QianwenCredentialPayload{
		AccessToken: "expired-primary",
		ExpiresAt:   time.Now().Add(-time.Minute).UTC().Format(time.RFC3339),
	}, nil)
	assert.ErrorIs(t, err, ErrAuthRequired)
}

func TestParsePersonalUsageCycles_MalformedFieldsGraceful(t *testing.T) {
	raw := json.RawMessage(`{
		"data": {
			"per1MonthPercentage": 1.5,
			"per1WeekPercentage": "0.25",
			"per1WeekResetTime": 1795500000000,
			"per3DayPercentage": 0.1
		}
	}`)
	cycles := parsePersonalUsageCycles(raw, nil)
	require.Len(t, cycles, 2)
	assert.Equal(t, "weekly", cycles[0].Cycle)
	assert.Equal(t, 25.0, cycles[0].UsedPercentage)
	assert.Equal(t, 75.0, cycles[0].RemainingPercentage)
	assert.Equal(t, "3d", cycles[1].Cycle)
	assert.Equal(t, 90.0, cycles[1].RemainingPercentage)
}

func TestPollDeviceToken_NumericFieldsAndVariants(t *testing.T) {
	t.Run("numeric_pascal_case", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"Success": true,
				"Data": {
					"Status": "complete",
					"Credentials": {
						"AccessToken": "tok-num-1",
						"ExpireTime": 1796083200000,
						"User": {
							"Id": 123456789,
							"AliyunId": 9876543210123456,
							"Email": "num@example.com"
						}
					}
				}
			}`))
		}))
		defer srv.Close()

		c := NewClient(srv.Client())
		c.AuthEndpoint = srv.URL

		res, err := c.PollDeviceTokenOnce(context.Background(), "cid", "dc", "ver")
		require.NoError(t, err)
		require.Equal(t, "complete", res.Status)
		require.NotNil(t, res.Credentials)
		assert.Equal(t, "tok-num-1", res.Credentials.AccessToken)
		assert.Equal(t, "123456789", res.Credentials.User.ID)
		assert.Equal(t, "9876543210123456", res.Credentials.User.AliyunID)
		assert.Equal(t, "num@example.com", res.Credentials.User.Email)
		assert.Equal(t, time.UnixMilli(1796083200000).UTC().Format(time.RFC3339), res.Credentials.ExpiresAt)
	})

	t.Run("camel_snake_unix_seconds", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"status": "completed",
				"credentials": {
					"access_token": "tok-snake-2",
					"expire_time": 1796083200,
					"user": {
						"user_id": 42,
						"aliyun_id": 555666,
						"email": "snake@example.com"
					}
				}
			}`))
		}))
		defer srv.Close()

		c := NewClient(srv.Client())
		c.AuthEndpoint = srv.URL

		res, err := c.PollDeviceTokenOnce(context.Background(), "cid", "dc", "ver")
		require.NoError(t, err)
		require.Equal(t, "complete", res.Status)
		require.NotNil(t, res.Credentials)
		assert.Equal(t, "tok-snake-2", res.Credentials.AccessToken)
		assert.Equal(t, "42", res.Credentials.User.ID)
		assert.Equal(t, "555666", res.Credentials.User.AliyunID)
		assert.Equal(t, time.Unix(1796083200, 0).UTC().Format(time.RFC3339), res.Credentials.ExpiresAt)
	})
}

func TestPollDeviceToken_TerminalNotFoundAndNonRetryableErrors(t *testing.T) {
	t.Run("not_found_stops_immediately", func(t *testing.T) {
		var calls atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"Data":{"Status":"not_found"},"Success":true}`))
		}))
		defer srv.Close()

		now := time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC)
		c := NewClient(srv.Client())
		c.AuthEndpoint = srv.URL
		c.Now = func() time.Time { return now }
		c.Sleep = func(ctx context.Context, d time.Duration) error {
			now = now.Add(d)
			return nil
		}

		_, err := c.PollDeviceToken(context.Background(), &DeviceAuthStart{
			ClientID:   "cid",
			DeviceCode: "dc",
			ExpiresIn:  120,
			Interval:   2,
		}, nil)
		assert.ErrorIs(t, err, ErrDeviceSessionInvalid)
		assert.Equal(t, int32(1), calls.Load())
	})

	t.Run("http_400_and_malformed_json_fail_fast", func(t *testing.T) {
		for _, tc := range []struct {
			name   string
			status int
			body   string
		}{
			{"http_400", http.StatusBadRequest, `{"error":"invalid_request"}`},
			{"malformed_json", http.StatusOK, `not-json`},
		} {
			t.Run(tc.name, func(t *testing.T) {
				var calls atomic.Int32
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					w.WriteHeader(tc.status)
					_, _ = w.Write([]byte(tc.body))
				}))
				defer srv.Close()

				now := time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC)
				c := NewClient(srv.Client())
				c.AuthEndpoint = srv.URL
				c.Now = func() time.Time { return now }
				c.Sleep = func(ctx context.Context, d time.Duration) error {
					now = now.Add(d)
					return nil
				}

				_, err := c.PollDeviceToken(context.Background(), &DeviceAuthStart{
					ClientID:   "cid",
					DeviceCode: "dc",
					ExpiresIn:  120,
					Interval:   2,
				}, nil)
				require.Error(t, err)
				assert.Equal(t, int32(1), calls.Load())
			})
		}
	})
}

func TestFetchAccountInfo_NumericAliyunID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"aliyunId":1234567890123456,"email":"user@aliyun.test"}}`))
	}))
	defer srv.Close()

	c := NewClient(srv.Client())
	c.APIEndpoint = srv.URL

	profile, err := c.FetchAccountInfo(context.Background(), "tok-1")
	require.NoError(t, err)
	assert.Equal(t, "1234567890123456", profile.AliyunID)
	assert.Equal(t, "user@aliyun.test", profile.Email)
}
