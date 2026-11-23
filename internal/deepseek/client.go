package deepseek

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"graviton/internal/storage"
)

// Client calls the official DeepSeek balance API.
type Client struct {
	httpClient *http.Client
	baseURL    string
	now        func() time.Time
}

// NewClient constructs a DeepSeek HTTP client pointing at DefaultBaseURL.
func NewClient(httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	return &Client{
		httpClient: httpClient,
		baseURL:    DefaultBaseURL,
		now:        time.Now,
	}
}

type balanceAPIResponse struct {
	IsAvailable  bool `json:"is_available"`
	BalanceInfos []struct {
		Currency        string `json:"currency"`
		TotalBalance    string `json:"total_balance"`
		GrantedBalance  string `json:"granted_balance"`
		ToppedUpBalance string `json:"topped_up_balance"`
	} `json:"balance_infos"`
}

type apiErrorEnvelope struct {
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    any    `json:"code"`
	} `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

// FetchBalance queries GET /user/balance using the provided Bearer API key.
func (c *Client) FetchBalance(ctx context.Context, apiKey string) (*storage.DeepSeekBalanceSnapshot, error) {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return nil, ErrAuthInvalid
	}

	endpoint := strings.TrimRight(c.baseURL, "/") + "/user/balance"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("构造请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求 DeepSeek 接口失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("读取 DeepSeek 响应失败: %w", err)
	}

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, ErrAuthInvalid
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail := extractErrorDetail(body)
		if detail != "" {
			return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, detail)
		}
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	var parsed balanceAPIResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("解析余额响应失败: %w", err)
	}

	infos := make([]storage.DeepSeekBalanceInfo, 0, len(parsed.BalanceInfos))
	for _, item := range parsed.BalanceInfos {
		currency := strings.ToUpper(strings.TrimSpace(item.Currency))
		if currency == "" {
			currency = "CNY"
		}
		infos = append(infos, storage.DeepSeekBalanceInfo{
			Currency:        currency,
			TotalBalance:    normalizeBalanceString(item.TotalBalance),
			GrantedBalance:  normalizeBalanceString(item.GrantedBalance),
			ToppedUpBalance: normalizeBalanceString(item.ToppedUpBalance),
		})
	}

	return &storage.DeepSeekBalanceSnapshot{
		IsAvailable:     parsed.IsAvailable,
		BalanceInfos:    infos,
		AuthInvalid:     false,
		LastRefreshedAt: c.now().UTC().Format(time.RFC3339),
		ErrorMessage:    "",
	}, nil
}

func normalizeBalanceString(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "0.00"
	}
	return s
}

func extractErrorDetail(body []byte) string {
	var env apiErrorEnvelope
	if err := json.Unmarshal(body, &env); err == nil {
		if env.Error != nil && strings.TrimSpace(env.Error.Message) != "" {
			return strings.TrimSpace(env.Error.Message)
		}
		if strings.TrimSpace(env.Message) != "" {
			return strings.TrimSpace(env.Message)
		}
	}
	trimmed := strings.TrimSpace(string(body))
	if len(trimmed) > 200 {
		return trimmed[:200] + "..."
	}
	return trimmed
}
