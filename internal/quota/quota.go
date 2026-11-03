package quota

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"codetool/internal/storage"
)

var (
	LoadProjectEndpoints = []string{
		"https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
		"https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist",
		"https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
	}

	AvailableModelsEndpoints = []string{
		"https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
		"https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels",
		"https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
	}

	QuotaSummaryEndpoints = []string{
		"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
		"https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
		"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
	}

	UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/44.5.1 Chrome/130.0.6723.137 Electron/33.2.1 Safari/537.36"
)

var (
	ErrUnauthorized = errors.New("401 unauthorized")
	ErrForbidden    = errors.New("403 forbidden")
)

// Tier represents subscription tier in loadCodeAssist response.
type Tier struct {
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	IsDefault bool   `json:"isDefault,omitempty"`
}

// LoadProjectResponse represents the response from loadCodeAssist.
type LoadProjectResponse struct {
	ProjectID    string `json:"cloudaicompanionProject,omitempty"`
	CurrentTier  *Tier  `json:"currentTier,omitempty"`
	PaidTier     *Tier  `json:"paidTier,omitempty"`
	AllowedTiers []Tier `json:"allowedTiers,omitempty"`
}

// RawQuotaInfo represents remainingFraction inside a model's quotaInfo.
type RawQuotaInfo struct {
	RemainingFraction *float64 `json:"remainingFraction,omitempty"`
	ResetTime         string   `json:"resetTime,omitempty"`
}

// RawModelInfo represents a single model in fetchAvailableModels.
type RawModelInfo struct {
	DisplayName string        `json:"displayName,omitempty"`
	QuotaInfo   *RawQuotaInfo `json:"quotaInfo,omitempty"`
	Disabled    *bool         `json:"disabled,omitempty"`
	Model       string        `json:"model,omitempty"`
}

// RawQuotaResponse represents the response from fetchAvailableModels.
type RawQuotaResponse struct {
	Models                  map[string]RawModelInfo            `json:"models"`
	DeprecatedModelIDs      map[string]map[string]string       `json:"deprecatedModelIds,omitempty"`
	AgentModelSorts         []struct{ Groups []struct{ ModelIDs []string } } `json:"agentModelSorts,omitempty"`
	ImageGenerationModelIDs []string                           `json:"imageGenerationModelIds,omitempty"`
	TieredModelIDs          map[string][]string                `json:"tieredModelIds,omitempty"`
}

// RawQuotaSummaryBucket represents a bucket in retrieveUserQuotaSummary.
type RawQuotaSummaryBucket struct {
	BucketID          string   `json:"bucketId,omitempty"`
	Window            string   `json:"window,omitempty"`
	RemainingFraction *float64 `json:"remainingFraction,omitempty"`
	ResetTime         string   `json:"resetTime,omitempty"`
	DisplayName       string   `json:"displayName,omitempty"`
	Description       string   `json:"description,omitempty"`
}

// RawQuotaSummaryGroup represents a group in retrieveUserQuotaSummary.
type RawQuotaSummaryGroup struct {
	DisplayName string                  `json:"displayName,omitempty"`
	Description string                  `json:"description,omitempty"`
	Buckets     []RawQuotaSummaryBucket `json:"buckets,omitempty"`
}

// RawQuotaSummaryResponse represents the response from retrieveUserQuotaSummary.
type RawQuotaSummaryResponse struct {
	Groups []RawQuotaSummaryGroup `json:"groups"`
}

// QuotaService queries and merges quota info across endpoints.
type QuotaService struct {
	HTTPClient              *http.Client
	LoadProjectEndpoints    []string
	AvailableModelEndpoints []string
	QuotaSummaryEndpoints   []string
}

// NewQuotaService creates a QuotaService with default fallback endpoints.
func NewQuotaService(client *http.Client) *QuotaService {
	if client == nil {
		client = &http.Client{
			Timeout: 15 * time.Second,
		}
	}
	return &QuotaService{
		HTTPClient:              client,
		LoadProjectEndpoints:    LoadProjectEndpoints,
		AvailableModelEndpoints: AvailableModelsEndpoints,
		QuotaSummaryEndpoints:   QuotaSummaryEndpoints,
	}
}

// NormalizeSubscriptionTier normalizes tier string to FREE, PRO, ULTRA, etc.
func NormalizeSubscriptionTier(raw string) string {
	lower := strings.ToLower(strings.TrimSpace(raw))
	switch {
	case strings.Contains(lower, "ultra"):
		return "ULTRA"
	case strings.Contains(lower, "pro"):
		return "PRO"
	case strings.Contains(lower, "enterprise"):
		return "ENTERPRISE"
	case strings.Contains(lower, "team"):
		return "TEAM"
	default:
		return "FREE"
	}
}

// FetchProjectAndTier calls loadCodeAssist across fallback endpoints.
func (s *QuotaService) FetchProjectAndTier(ctx context.Context, accessToken string) (projectID string, tier string, err error) {
	meta := map[string]interface{}{
		"metadata": map[string]string{
			"ideType": "ANTIGRAVITY",
		},
	}
	reqBody, _ := json.Marshal(meta)

	var lastErr error
	for _, ep := range s.LoadProjectEndpoints {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, ep, bytes.NewReader(reqBody))
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", UserAgent)

		resp, err := s.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusUnauthorized {
			return "", "", ErrUnauthorized
		}
		if resp.StatusCode == http.StatusForbidden {
			return "", "", ErrForbidden
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(resp.Body)
			lastErr = fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
			continue
		}

		var loadResp LoadProjectResponse
		if err := json.NewDecoder(resp.Body).Decode(&loadResp); err != nil {
			lastErr = err
			continue
		}

		// Tier precedence: paidTier -> currentTier -> allowedTiers -> default FREE
		rawTier := ""
		if loadResp.PaidTier != nil {
			if loadResp.PaidTier.ID != "" {
				rawTier = loadResp.PaidTier.ID
			} else {
				rawTier = loadResp.PaidTier.Name
			}
		} else if loadResp.CurrentTier != nil {
			if loadResp.CurrentTier.ID != "" {
				rawTier = loadResp.CurrentTier.ID
			} else {
				rawTier = loadResp.CurrentTier.Name
			}
		} else {
			for _, t := range loadResp.AllowedTiers {
				if t.IsDefault || strings.Contains(strings.ToLower(t.ID), "free") {
					rawTier = t.ID
					break
				}
			}
		}

		tier = NormalizeSubscriptionTier(rawTier)
		return loadResp.ProjectID, tier, nil
	}

	return "", "FREE", lastErr
}

// FetchAvailableModels calls fetchAvailableModels across fallback endpoints.
func (s *QuotaService) FetchAvailableModels(ctx context.Context, accessToken string, projectID string) (*RawQuotaResponse, error) {
	payload := map[string]interface{}{}
	if projectID != "" {
		payload["project"] = projectID
	}
	reqBody, _ := json.Marshal(payload)

	var lastErr error
	for _, ep := range s.AvailableModelEndpoints {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, ep, bytes.NewReader(reqBody))
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", UserAgent)

		resp, err := s.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusUnauthorized {
			return nil, ErrUnauthorized
		}
		if resp.StatusCode == http.StatusForbidden {
			return nil, ErrForbidden
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(resp.Body)
			lastErr = fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
			continue
		}

		var rawResp RawQuotaResponse
		if err := json.NewDecoder(resp.Body).Decode(&rawResp); err != nil {
			lastErr = err
			continue
		}
		return &rawResp, nil
	}

	return nil, fmt.Errorf("all fetchAvailableModels endpoints failed: %w", lastErr)
}

// FetchQuotaSummary calls retrieveUserQuotaSummary across fallback endpoints.
func (s *QuotaService) FetchQuotaSummary(ctx context.Context, accessToken string, projectID string) ([]storage.QuotaGroup, error) {
	payload := map[string]interface{}{}
	if projectID != "" {
		payload["project"] = projectID
	}
	reqBody, _ := json.Marshal(payload)

	var lastErr error
	for _, ep := range s.QuotaSummaryEndpoints {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, ep, bytes.NewReader(reqBody))
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", UserAgent)

		resp, err := s.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusUnauthorized {
			return nil, ErrUnauthorized
		}
		if resp.StatusCode == http.StatusForbidden {
			return nil, ErrForbidden
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(resp.Body)
			lastErr = fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
			continue
		}

		var rawSummary RawQuotaSummaryResponse
		if err := json.NewDecoder(resp.Body).Decode(&rawSummary); err != nil {
			lastErr = err
			continue
		}

		groups := make([]storage.QuotaGroup, 0, len(rawSummary.Groups))
		for _, g := range rawSummary.Groups {
			buckets := make([]storage.QuotaBucket, 0, len(g.Buckets))
			for _, b := range g.Buckets {
				if b.RemainingFraction == nil {
					continue
				}
				buckets = append(buckets, storage.QuotaBucket{
					BucketID:          b.BucketID,
					Window:            b.Window,
					RemainingFraction: *b.RemainingFraction,
					ResetTime:         b.ResetTime,
					DisplayName:       b.DisplayName,
					Description:       b.Description,
				})
			}
			groups = append(groups, storage.QuotaGroup{
				DisplayName: g.DisplayName,
				Description: g.Description,
				Buckets:     buckets,
			})
		}
		return groups, nil
	}

	return nil, fmt.Errorf("all retrieveUserQuotaSummary endpoints failed: %w", lastErr)
}

// FetchCompleteQuota queries loadCodeAssist, fetchAvailableModels, and retrieveUserQuotaSummary,
// and synthesizes a complete QuotaSnapshot.
func (s *QuotaService) FetchCompleteQuota(ctx context.Context, accessToken string, lastSnapshot *storage.QuotaSnapshot) (storage.QuotaSnapshot, error) {
	nowStr := time.Now().UTC().Format(time.RFC3339)

	// 1. Fetch project ID and tier
	projectID, tier, err := s.FetchProjectAndTier(ctx, accessToken)
	if err != nil {
		if errors.Is(err, ErrUnauthorized) {
			return storage.QuotaSnapshot{}, ErrUnauthorized
		}
		if errors.Is(err, ErrForbidden) {
			snap := storage.QuotaSnapshot{
				SubscriptionTier:    "FREE",
				RemainingPercentage: 0,
				LastRefreshedAt:     nowStr,
				IsForbidden:         true,
				ErrorMessage:        "账号受限 (403 Forbidden)",
			}
			if lastSnapshot != nil {
				snap.Groups = lastSnapshot.Groups
				snap.Models = lastSnapshot.Models
			}
			return snap, ErrForbidden
		}
		// If loadCodeAssist failed, use existing tier if present
		if lastSnapshot != nil && lastSnapshot.SubscriptionTier != "" {
			tier = lastSnapshot.SubscriptionTier
		} else {
			tier = "FREE"
		}
	}

	// 2. Fetch grouped quota summary (best effort)
	groups, summaryErr := s.FetchQuotaSummary(ctx, accessToken, projectID)
	if summaryErr != nil && errors.Is(summaryErr, ErrUnauthorized) {
		return storage.QuotaSnapshot{}, ErrUnauthorized
	}

	// 3. Fetch available models
	modelsResp, modelsErr := s.FetchAvailableModels(ctx, accessToken, projectID)
	if modelsErr != nil && errors.Is(modelsErr, ErrUnauthorized) {
		return storage.QuotaSnapshot{}, ErrUnauthorized
	}

	if summaryErr != nil && modelsErr != nil {
		// Both failed: preserve last snapshot if available
		if lastSnapshot != nil {
			retained := *lastSnapshot
			retained.ErrorMessage = fmt.Sprintf("额度刷新失败: %v", modelsErr)
			return retained, modelsErr
		}
		return storage.QuotaSnapshot{
			SubscriptionTier:    tier,
			RemainingPercentage: -1,
			LastRefreshedAt:     nowStr,
			ErrorMessage:        fmt.Sprintf("额度接口连接失败: %v", modelsErr),
		}, modelsErr
	}

	// 4. Parse models
	parsedModels := make([]storage.ModelQuota, 0)
	if modelsResp != nil && modelsResp.Models != nil {
		for name, m := range modelsResp.Models {
			nameLower := strings.ToLower(name)
			// Filter disabled
			if (m.Disabled != nil && *m.Disabled) || strings.Contains(nameLower, "-disabled") || strings.HasSuffix(nameLower, "_disabled") {
				continue
			}

			// Model-level fraction
			var modelPct *int
			var modelReset string
			if m.QuotaInfo != nil {
				if m.QuotaInfo.RemainingFraction != nil {
					p := int(math.Round(*m.QuotaInfo.RemainingFraction * 100))
					modelPct = &p
				}
				modelReset = m.QuotaInfo.ResetTime
			}

			// Group-level fallback
			var groupPct *int
			var groupReset string
			if len(groups) > 0 {
				matched := matchGroupForModel(nameLower, groups)
				if matched != nil {
					bucket := pickBestBucket(matched.Buckets)
					if bucket != nil {
						p := int(math.Round(bucket.RemainingFraction * 100))
						groupPct = &p
						groupReset = bucket.ResetTime
					}
				}
			}

			// Combine
			finalPct := 100
			finalReset := ""
			if modelPct != nil && groupPct != nil {
				if *modelPct <= 0 {
					finalPct = 0
					if modelReset != "" {
						finalReset = modelReset
					} else {
						finalReset = groupReset
					}
				} else {
					if *modelPct < *groupPct {
						finalPct = *modelPct
						finalReset = modelReset
					} else {
						finalPct = *groupPct
						finalReset = groupReset
					}
				}
			} else if modelPct != nil {
				finalPct = *modelPct
				finalReset = modelReset
			} else if groupPct != nil {
				finalPct = *groupPct
				finalReset = groupReset
			}

			disp := m.DisplayName
			if disp == "" {
				disp = name
			}

			parsedModels = append(parsedModels, storage.ModelQuota{
				Name:        name,
				DisplayName: disp,
				Percentage:  finalPct,
				ResetTime:   finalReset,
			})
		}
	}

	// 5. Compute account-level aggregate remaining percentage and reset time
	accountPct, accountReset := calculateAggregateQuota(groups, parsedModels)

	snapshot := storage.QuotaSnapshot{
		SubscriptionTier:    tier,
		RemainingPercentage: accountPct,
		ResetTime:           accountReset,
		LastRefreshedAt:     nowStr,
		Groups:              groups,
		Models:              parsedModels,
		IsForbidden:         false,
	}

	return snapshot, nil
}

// matchGroupForModel finds the best matching group for a model name.
func matchGroupForModel(modelName string, groups []storage.QuotaGroup) *storage.QuotaGroup {
	isArgon := strings.Contains(modelName, "argon")
	isClaudeOrGPT := !isArgon && (strings.HasPrefix(modelName, "claude") || strings.HasPrefix(modelName, "gpt"))

	for i := range groups {
		g := &groups[i]
		gName := strings.ToLower(g.DisplayName)
		hasArgon := strings.Contains(gName, "argon")
		if !hasArgon {
			for _, b := range g.Buckets {
				if strings.Contains(strings.ToLower(b.BucketID), "argon") || strings.Contains(strings.ToLower(b.DisplayName), "argon") {
					hasArgon = true
					break
				}
			}
		}

		if isArgon {
			if hasArgon {
				return g
			}
			continue
		}
		if hasArgon {
			continue
		}

		isClaudeGroup := strings.Contains(gName, "claude") || strings.Contains(gName, "gpt") || strings.Contains(gName, "3p")
		if isClaudeOrGPT && isClaudeGroup {
			return g
		}
		if !isClaudeOrGPT && !isClaudeGroup {
			return g
		}
	}

	if isArgon && len(groups) > 0 {
		// Fallback to first non-claude group
		for i := range groups {
			gName := strings.ToLower(groups[i].DisplayName)
			if !strings.Contains(gName, "claude") && !strings.Contains(gName, "gpt") {
				return &groups[i]
			}
		}
	}

	return nil
}

// pickBestBucket selects the most restrictive / relevant bucket between 5h and weekly.
func pickBestBucket(buckets []storage.QuotaBucket) *storage.QuotaBucket {
	if len(buckets) == 0 {
		return nil
	}

	var bucket5h, bucketWeekly *storage.QuotaBucket
	for i := range buckets {
		b := &buckets[i]
		win := strings.ToLower(b.Window + " " + b.BucketID)
		if strings.Contains(win, "5h") || strings.Contains(win, "hour") {
			bucket5h = b
		}
		if strings.Contains(win, "week") || strings.Contains(win, "7d") {
			bucketWeekly = b
		}
	}

	if bucket5h != nil && bucketWeekly != nil {
		if bucketWeekly.RemainingFraction <= 0.001 {
			return bucketWeekly
		}
		if bucket5h.RemainingFraction < bucketWeekly.RemainingFraction {
			return bucket5h
		}
		return bucketWeekly
	}
	if bucket5h != nil {
		return bucket5h
	}
	if bucketWeekly != nil {
		return bucketWeekly
	}
	return &buckets[0]
}

// calculateAggregateQuota computes overall percentage (0-100 or -1 if unknown) and earliest reset time.
func calculateAggregateQuota(groups []storage.QuotaGroup, models []storage.ModelQuota) (int, string) {
	// If groups are present, use the most constrained group bucket
	minFraction := 1.0
	resetTime := ""
	foundBucket := false

	for _, g := range groups {
		for _, b := range g.Buckets {
			foundBucket = true
			if b.RemainingFraction < minFraction {
				minFraction = b.RemainingFraction
				resetTime = b.ResetTime
			} else if b.RemainingFraction == minFraction && resetTime == "" && b.ResetTime != "" {
				resetTime = b.ResetTime
			}
		}
	}

	if foundBucket {
		pct := int(math.Round(minFraction * 100))
		return pct, resetTime
	}

	// Fallback to model quotas
	if len(models) > 0 {
		minPct := 100
		for _, m := range models {
			if m.Percentage < minPct {
				minPct = m.Percentage
				resetTime = m.ResetTime
			}
		}
		return minPct, resetTime
	}

	return -1, ""
}
