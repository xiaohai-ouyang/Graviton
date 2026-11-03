package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"codetool/internal/cred"
)

const (
	DefaultClientID     = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
	DefaultClientSecret = "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"
	TokenEndpoint       = "https://oauth2.googleapis.com/token"
	UserInfoEndpoint    = "https://www.googleapis.com/oauth2/v2/userinfo"
	UserAgent           = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/44.5.1 Chrome/130.0.6723.137 Electron/33.2.1 Safari/537.36"
)

var (
	ErrInvalidGrant = errors.New("invalid_grant: 登录已失效，请在客户端重新登录后重新收录")
	ErrAuthFailed   = errors.New("oauth authentication failed")
)

// UserInfo represents the response from Google UserInfo endpoint.
type UserInfo struct {
	Email      string `json:"email"`
	Name       string `json:"name"`
	GivenName  string `json:"given_name"`
	FamilyName string `json:"family_name"`
	Picture    string `json:"picture"`
}

// GetDisplayName returns the best human-readable display name.
func (u *UserInfo) GetDisplayName() string {
	if strings.TrimSpace(u.Name) != "" {
		return strings.TrimSpace(u.Name)
	}
	combined := strings.TrimSpace(fmt.Sprintf("%s %s", u.GivenName, u.FamilyName))
	if combined != "" {
		return combined
	}
	return u.Email
}

// RefreshTokenResponse represents the response from Google OAuth token refresh.
type RefreshTokenResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int64  `json:"expires_in"`
	TokenType    string `json:"token_type"`
	RefreshToken string `json:"refresh_token,omitempty"`
	IDToken      string `json:"id_token,omitempty"`
}

// OAuthService manages OAuth refresh and userinfo queries.
type OAuthService struct {
	ClientID     string
	ClientSecret string
	TokenURL     string
	UserInfoURL  string
	HTTPClient   *http.Client
}

// NewOAuthService creates an OAuthService with standard defaults.
func NewOAuthService(httpClient *http.Client) *OAuthService {
	if httpClient == nil {
		httpClient = &http.Client{
			Timeout: 15 * time.Second,
		}
	}
	return &OAuthService{
		ClientID:     DefaultClientID,
		ClientSecret: DefaultClientSecret,
		TokenURL:     TokenEndpoint,
		UserInfoURL:  UserInfoEndpoint,
		HTTPClient:   httpClient,
	}
}

// FetchUserInfo calls Google UserInfo endpoint with an access token.
func (s *OAuthService) FetchUserInfo(ctx context.Context, accessToken string) (*UserInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.UserInfoURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create userinfo request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("User-Agent", UserAgent)

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("userinfo request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read userinfo response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("userinfo request returned status %d: %s", resp.StatusCode, string(body))
	}

	var info UserInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return nil, fmt.Errorf("failed to parse userinfo JSON: %w", err)
	}

	if info.Email == "" {
		return nil, errors.New("userinfo returned empty email")
	}

	return &info, nil
}

// RefreshToken exchanges a refresh_token for a new access_token.
func (s *OAuthService) RefreshToken(ctx context.Context, refreshToken string) (*RefreshTokenResponse, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return nil, errors.New("cannot refresh token: empty refresh token")
	}

	data := url.Values{}
	data.Set("client_id", s.ClientID)
	data.Set("client_secret", s.ClientSecret)
	data.Set("refresh_token", refreshToken)
	data.Set("grant_type", "refresh_token")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.TokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create refresh token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", UserAgent)

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token refresh network error: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read token refresh response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		bodyStr := string(body)
		if strings.Contains(bodyStr, "invalid_grant") {
			return nil, ErrInvalidGrant
		}
		return nil, fmt.Errorf("token refresh failed with status %d: %s", resp.StatusCode, bodyStr)
	}

	var tokenResp RefreshTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse token refresh JSON: %w", err)
	}

	if tokenResp.AccessToken == "" {
		return nil, errors.New("token refresh response missing access_token")
	}

	return &tokenResp, nil
}

// EnsureFreshToken checks if token is expired or within skew (5 min). If so, it refreshes it.
// Returns (updatedPayload, wasRefreshed, error).
func (s *OAuthService) EnsureFreshToken(ctx context.Context, payload *cred.CredentialPayload, force bool) (*cred.CredentialPayload, bool, error) {
	if !force && !payload.NeedsRefresh(5*time.Minute) {
		return payload, false, nil
	}

	refreshed, err := s.RefreshToken(ctx, payload.Token.RefreshToken)
	if err != nil {
		return payload, false, err
	}

	// Update token payload
	updated := *payload
	updated.Token.AccessToken = refreshed.AccessToken
	if refreshed.TokenType != "" {
		updated.Token.TokenType = refreshed.TokenType
	}
	if refreshed.ExpiresIn > 0 {
		updated.Token.ExpiresIn = refreshed.ExpiresIn
		updated.Token.Expiry = time.Now().Add(time.Duration(refreshed.ExpiresIn) * time.Second).Format(time.RFC3339Nano)
	}
	if refreshed.RefreshToken != "" {
		updated.Token.RefreshToken = refreshed.RefreshToken
	}
	if refreshed.IDToken != "" {
		updated.IDToken = refreshed.IDToken
	}

	return &updated, true, nil
}
