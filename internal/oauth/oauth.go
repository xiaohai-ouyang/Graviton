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

	"graviton/internal/cred"
)

const (
	DefaultClientID     = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
	DefaultClientSecret = "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"
	AuthEndpoint        = "https://accounts.google.com/o/oauth2/v2/auth"
	TokenEndpoint       = "https://oauth2.googleapis.com/token"
	UserInfoEndpoint    = "https://www.googleapis.com/oauth2/v2/userinfo"
	UserAgent           = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/44.5.1 Chrome/130.0.6723.137 Electron/33.2.1 Safari/537.36"
)

// DefaultScopes are the Google OAuth scopes requested by Antigravity.
var DefaultScopes = []string{
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
}

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

// OAuthService manages OAuth authorization, token exchange, refresh, and userinfo queries.
type OAuthService struct {
	ClientID     string
	ClientSecret string
	AuthURL      string
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
		AuthURL:      AuthEndpoint,
		TokenURL:     TokenEndpoint,
		UserInfoURL:  UserInfoEndpoint,
		HTTPClient:   httpClient,
	}
}

// BuildAuthURL constructs the Google OAuth 2.0 authorization URL for desktop login.
func (s *OAuthService) BuildAuthURL(redirectURI, state string) string {
	authBase := s.AuthURL
	if authBase == "" {
		authBase = AuthEndpoint
	}
	params := url.Values{}
	params.Set("client_id", s.ClientID)
	params.Set("redirect_uri", redirectURI)
	params.Set("response_type", "code")
	params.Set("scope", strings.Join(DefaultScopes, " "))
	params.Set("access_type", "offline")
	params.Set("prompt", "consent")
	params.Set("include_granted_scopes", "true")
	if state != "" {
		params.Set("state", state)
	}
	return authBase + "?" + params.Encode()
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

	return s.postTokenForm(ctx, data, "token refresh")
}

// ExchangeCode exchanges an OAuth authorization code for access and refresh tokens.
func (s *OAuthService) ExchangeCode(ctx context.Context, code, redirectURI string) (*RefreshTokenResponse, error) {
	if strings.TrimSpace(code) == "" {
		return nil, errors.New("cannot exchange code: empty authorization code")
	}
	if strings.TrimSpace(redirectURI) == "" {
		return nil, errors.New("cannot exchange code: empty redirect URI")
	}

	data := url.Values{}
	data.Set("client_id", s.ClientID)
	data.Set("client_secret", s.ClientSecret)
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)
	data.Set("grant_type", "authorization_code")

	return s.postTokenForm(ctx, data, "code exchange")
}

func (s *OAuthService) postTokenForm(ctx context.Context, data url.Values, opName string) (*RefreshTokenResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.TokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create %s request: %w", opName, err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", UserAgent)

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s network error: %w", opName, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read %s response: %w", opName, err)
	}

	if resp.StatusCode != http.StatusOK {
		bodyStr := string(body)
		if strings.Contains(bodyStr, "invalid_grant") {
			return nil, ErrInvalidGrant
		}
		return nil, fmt.Errorf("%s failed with status %d: %s", opName, resp.StatusCode, bodyStr)
	}

	var tokenResp RefreshTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse %s JSON: %w", opName, err)
	}

	if tokenResp.AccessToken == "" {
		return nil, fmt.Errorf("%s response missing access_token", opName)
	}

	return &tokenResp, nil
}

// BuildCredentialPayload constructs a CredentialPayload from an OAuth token response.
func BuildCredentialPayload(tokenResp *RefreshTokenResponse, fallbackRefreshToken string) *cred.CredentialPayload {
	refreshToken := strings.TrimSpace(tokenResp.RefreshToken)
	if refreshToken == "" {
		refreshToken = strings.TrimSpace(fallbackRefreshToken)
	}
	tokenType := strings.TrimSpace(tokenResp.TokenType)
	if tokenType == "" {
		tokenType = "Bearer"
	}
	var expiry string
	if tokenResp.ExpiresIn > 0 {
		expiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second).Format(time.RFC3339Nano)
	}
	return &cred.CredentialPayload{
		Token: cred.TokenInfo{
			AccessToken:  tokenResp.AccessToken,
			TokenType:    tokenType,
			RefreshToken: refreshToken,
			Expiry:       expiry,
			ExpiresIn:    tokenResp.ExpiresIn,
		},
		AuthMethod:   "consumer",
		IDToken:      tokenResp.IDToken,
		IDTokenEmail: cred.ExtractEmailFromIDToken(tokenResp.IDToken),
	}
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
