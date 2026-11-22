package qianwen

import (
	"errors"
	"graviton/internal/storage"
)

const (
	DefaultAuthEndpoint   = "https://t.qianwenai.com"
	DefaultAPIEndpoint    = "https://cli.qianwenai.com"
	DefaultCSDataEndpoint = "https://cs-data.qianwenai.com"
	DefaultUserAgent      = "qianwen-cli/1.12.0"
	DefaultRegion         = "cn-beijing"

	CommodityPersonal  = "sfm_tokenplansolo_public_cn"
	CommodityTeam      = "sfm_tokenplanteams_dp_cn"
	CommodityTeamAddon = "sfm_tokenplanteamsaddon_dp_cn"

	ProductModelStudioRegional   = "ModelStudioRegional"
	ActionGenerateCLIAccessToken = "GenerateCLIAccessToken"
	VersionGenerateCLIToken      = "2026-02-10"

	ProductQianwenAuth = "qianwen-auth"
	ActionLogout       = "Logout"

	ProductBssOpenAPIV3        = "BssOpenAPI-V3"
	ProductBssOpenAPI          = "BssOpenApi"
	ActionDescribeFrInstances  = "DescribeFrInstances"
	ActionGetSeatSummary       = "GetSeatSubscriptionSummary"
	ActionCheckTeamAutoRenewal = "CheckTokenPlanAutoRenewal"

	CSDataProduct = "sfm_bailian"
	CSDataAction  = "BroadScopeAspnGateway"

	APIPersonalSubscription = "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/subscription"
	APIPersonalQuotaConfig  = "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/quota-config"
	APIPersonalUsage        = "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage"
)

var (
	ErrAuthRequired         = errors.New("qianwen authentication required")
	ErrDerivedTokenExpired  = errors.New("qianwen derived cs-data token expired")
	ErrDeviceExpired        = errors.New("qianwen device code expired")
	ErrDeviceSessionInvalid = errors.New("qianwen device session invalid or consumed")
	ErrAccessDenied         = errors.New("qianwen authorization denied by user")
)

// PKCEParams holds the PKCE verifier and S256 challenge pair.
type PKCEParams struct {
	CodeVerifier        string `json:"-"`
	CodeChallenge       string `json:"codeChallenge"`
	CodeChallengeMethod string `json:"codeChallengeMethod"`
}

// DeviceAuthStart contains the device authorization session returned by /cli/device/code.
type DeviceAuthStart struct {
	ClientID        string `json:"clientId"`
	DeviceCode      string `json:"deviceCode"`
	VerificationURL string `json:"verificationUrl"`
	ExpiresIn       int    `json:"expiresIn"`
	Interval        int    `json:"interval"`
	CodeVerifier    string `json:"-"`
}

// UserProfile describes the authenticated Qianwen user identity.
type UserProfile struct {
	ID       string `json:"id,omitempty"`
	Email    string `json:"email,omitempty"`
	AliyunID string `json:"aliyunId,omitempty"`
}

// TokenCredentials holds the OAuth access token returned upon successful device authorization.
type TokenCredentials struct {
	AccessToken  string      `json:"-"`
	RefreshToken string      `json:"-"`
	ExpiresAt    string      `json:"expiresAt"`
	User         UserProfile `json:"user"`
}

// PollResult represents a single poll attempt response from /cli/device/token.
type PollResult struct {
	Status      string            `json:"status"`
	Credentials *TokenCredentials `json:"credentials,omitempty"`
}

// AccountDisplay is the sanitized frontend projection for a Qianwen account (no secrets).
type AccountDisplay struct {
	ID             string                       `json:"id"`
	UserID         string                       `json:"userId,omitempty"`
	AliyunID       string                       `json:"aliyunId,omitempty"`
	Email          string                       `json:"email,omitempty"`
	Name           string                       `json:"name"`
	TokenExpiresAt string                       `json:"tokenExpiresAt,omitempty"`
	CreatedAt      string                       `json:"createdAt"`
	Quota          storage.QianwenQuotaSnapshot `json:"quota"`
}

// AuthStartResponse is returned to the UI when initiating a Qianwen device flow login.
type AuthStartResponse struct {
	SessionID       string `json:"sessionId"`
	VerificationURL string `json:"verificationUrl"`
	DeviceCode      string `json:"deviceCode"`
	ExpiresIn       int    `json:"expiresIn"`
	Interval        int    `json:"interval"`
}

// AuthEvent is emitted asynchronously over Wails events during device polling.
type AuthEvent struct {
	SessionID string          `json:"sessionId"`
	Status    string          `json:"status"` // pending, slow_down, completing, complete, expired, denied, cancelled, error
	Interval  int             `json:"interval,omitempty"`
	Account   *AccountDisplay `json:"account,omitempty"`
	Error     string          `json:"error,omitempty"`
}

// BatchRefreshResult summarizes a single account outcome during concurrent refresh.
type BatchRefreshResult struct {
	AccountID string          `json:"accountId"`
	Label     string          `json:"label"`
	Success   bool            `json:"success"`
	Account   *AccountDisplay `json:"account,omitempty"`
	Error     string          `json:"error,omitempty"`
}
