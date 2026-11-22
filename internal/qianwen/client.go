package qianwen

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"graviton/internal/cred"
	"graviton/internal/storage"
)

const (
	defaultHTTPTimeout    = 30 * time.Second
	maxBackoffInterval    = 30 * time.Second
	maxErrorBodySnippet   = 300
	defaultPollInterval   = 5
	slowDownStepSeconds   = 5
	personalUsageCycleMax = 1.0
)

var personalSpecNames = map[string]string{
	"lite":      "Lite",
	"essential": "Essential",
	"standard":  "Standard",
	"pro":       "Pro",
}

// Client implements pure-HTTP Qianwen Device Flow + PKCE authentication and Token Plan queries.
type Client struct {
	AuthEndpoint   string
	APIEndpoint    string
	CSDataEndpoint string
	UserAgent      string
	HTTPClient     *http.Client
	Now            func() time.Time
	Sleep          func(context.Context, time.Duration) error
}

// NewClient constructs a Client with production endpoints and sensible timeouts.
func NewClient(httpClient *http.Client) *Client {
	if httpClient == nil {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.MaxIdleConns = 32
		transport.MaxIdleConnsPerHost = 16
		transport.IdleConnTimeout = 90 * time.Second
		httpClient = &http.Client{
			Timeout:   defaultHTTPTimeout,
			Transport: transport,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
	}
	return &Client{
		AuthEndpoint:   DefaultAuthEndpoint,
		APIEndpoint:    DefaultAPIEndpoint,
		CSDataEndpoint: DefaultCSDataEndpoint,
		UserAgent:      DefaultUserAgent,
		HTTPClient:     httpClient,
		Now:            time.Now,
		Sleep:          sleepWithContext,
	}
}

func sleepWithContext(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (c *Client) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

func (c *Client) sleep(ctx context.Context, d time.Duration) error {
	if c.Sleep != nil {
		return c.Sleep(ctx, d)
	}
	return sleepWithContext(ctx, d)
}

func (c *Client) userAgent() string {
	if strings.TrimSpace(c.UserAgent) != "" {
		return c.UserAgent
	}
	return DefaultUserAgent
}

func (c *Client) authBase() string {
	if strings.TrimSpace(c.AuthEndpoint) != "" {
		return strings.TrimRight(c.AuthEndpoint, "/")
	}
	return DefaultAuthEndpoint
}

func (c *Client) apiBase() string {
	if strings.TrimSpace(c.APIEndpoint) != "" {
		return strings.TrimRight(c.APIEndpoint, "/")
	}
	return DefaultAPIEndpoint
}

func (c *Client) csDataBase() string {
	if strings.TrimSpace(c.CSDataEndpoint) != "" {
		return strings.TrimRight(c.CSDataEndpoint, "/")
	}
	return DefaultCSDataEndpoint
}

func (c *Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

// GeneratePKCE creates a 32-byte random code_verifier and its S256 base64url code_challenge.
func GeneratePKCE() (PKCEParams, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return PKCEParams{}, fmt.Errorf("failed to generate PKCE verifier: %w", err)
	}
	verifier := base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	return PKCEParams{
		CodeVerifier:        verifier,
		CodeChallenge:       challenge,
		CodeChallengeMethod: "S256",
	}, nil
}

// StartDeviceAuth requests a device code and verification URL with PKCE S256 challenge.
func (c *Client) StartDeviceAuth(ctx context.Context, clientID string) (*DeviceAuthStart, error) {
	if strings.TrimSpace(clientID) == "" {
		return nil, errors.New("client_id is required")
	}
	pkce, err := GeneratePKCE()
	if err != nil {
		return nil, err
	}

	q := url.Values{}
	q.Set("client_id", clientID)
	q.Set("code_challenge", pkce.CodeChallenge)
	q.Set("code_challenge_method", pkce.CodeChallengeMethod)
	endpoint := fmt.Sprintf("%s/cli/device/code?%s", c.authBase(), q.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.userAgent())

	status, body, err := c.doRequest(req)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("device code init HTTP %d: %s", status, truncateSnippet(body))
	}

	var resp struct {
		Success bool `json:"Success"`
		Data    *struct {
			Token           string `json:"Token"`
			VerificationUrl string `json:"VerificationUrl"`
			ExpiresIn       int    `json:"ExpiresIn"`
			Interval        int    `json:"Interval"`
		} `json:"Data"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse device code response: %w", err)
	}
	if !resp.Success || resp.Data == nil {
		return nil, errors.New("device flow init failed: server returned Success=false")
	}
	if strings.TrimSpace(resp.Data.Token) == "" || strings.TrimSpace(resp.Data.VerificationUrl) == "" || resp.Data.ExpiresIn <= 0 {
		return nil, errors.New("device flow init failed: malformed response payload")
	}
	interval := resp.Data.Interval
	if interval <= 0 {
		interval = defaultPollInterval
	}

	return &DeviceAuthStart{
		ClientID:        clientID,
		DeviceCode:      resp.Data.Token,
		VerificationURL: resp.Data.VerificationUrl,
		ExpiresIn:       resp.Data.ExpiresIn,
		Interval:        interval,
		CodeVerifier:    pkce.CodeVerifier,
	}, nil
}

type nonRetryablePollError struct {
	err error
}

func (e *nonRetryablePollError) Error() string {
	return e.err.Error()
}

func (e *nonRetryablePollError) Unwrap() error {
	return e.err
}

// PollDeviceTokenOnce executes a single poll request to /cli/device/token.
func (c *Client) PollDeviceTokenOnce(ctx context.Context, clientID, deviceCode, codeVerifier string) (*PollResult, error) {
	q := url.Values{}
	q.Set("client_id", clientID)
	q.Set("token", deviceCode)
	if codeVerifier != "" {
		q.Set("code_verifier", codeVerifier)
	}
	endpoint := fmt.Sprintf("%s/cli/device/token?%s", c.authBase(), q.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return nil, &nonRetryablePollError{err: err}
	}
	req.Header.Set("User-Agent", c.userAgent())

	status, body, err := c.doRequest(req)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		lower := strings.ToLower(string(body))
		switch {
		case strings.Contains(lower, "expired"):
			return &PollResult{Status: "expired_token"}, nil
		case strings.Contains(lower, "access_denied"):
			return &PollResult{Status: "access_denied"}, nil
		case strings.Contains(lower, "slow_down"):
			return &PollResult{Status: "slow_down"}, nil
		}
		pollErr := fmt.Errorf("device token poll HTTP %d: %s", status, truncateSnippet(body))
		if status >= 400 && status < 500 && status != http.StatusTooManyRequests {
			return nil, &nonRetryablePollError{err: pollErr}
		}
		return nil, pollErr
	}

	root, err := decodeJSONMap(body)
	if err != nil {
		return nil, &nonRetryablePollError{err: fmt.Errorf("failed to parse device token response: %w", err)}
	}

	dataMap := lookupMap(root, "Data", "data")
	rawStatus := asFlexString(lookupAny(dataMap, "Status", "status"))
	if rawStatus == "" {
		rawStatus = asFlexString(lookupAny(root, "status", "Status"))
	}
	pollStatus := strings.ToLower(strings.TrimSpace(rawStatus))

	// Check explicit Success=false failures when status is not an expected pending/backoff signal.
	if successVal, hasSuccess := lookupBool(root, "Success", "success"); hasSuccess && !successVal {
		if pollStatus != "authorization_pending" && pollStatus != "slow_down" {
			errMsg := asFlexString(lookupAny(root, "Message", "message", "ErrorMessage", "errorMessage", "error_description"))
			if strings.Contains(strings.ToLower(errMsg), "expired") || pollStatus == "expired_token" {
				return &PollResult{Status: "expired_token"}, nil
			}
			if strings.Contains(strings.ToLower(errMsg), "denied") || pollStatus == "access_denied" {
				return &PollResult{Status: "access_denied"}, nil
			}
			if errMsg == "" {
				errMsg = "server returned Success=false"
			}
			return nil, &nonRetryablePollError{err: fmt.Errorf("device token poll failed: %s", errMsg)}
		}
	}

	if pollStatus == "" {
		pollStatus = "authorization_pending"
	}
	if pollStatus != "complete" && pollStatus != "completed" && pollStatus != "success" {
		return &PollResult{Status: pollStatus}, nil
	}

	credsMap := lookupMap(dataMap, "Credentials", "credentials")
	if credsMap == nil {
		credsMap = lookupMap(root, "credentials", "Credentials")
	}
	if credsMap == nil {
		credsMap = dataMap
	}

	accessToken := asFlexString(lookupAny(credsMap, "AccessToken", "access_token", "accessToken"))
	if accessToken == "" {
		return &PollResult{Status: "complete"}, nil
	}

	refreshToken := asFlexString(lookupAny(credsMap, "RefreshToken", "refresh_token", "refreshToken"))
	expiresAt := asTimestampRFC3339(lookupAny(credsMap, "ExpireTime", "expire_time", "expireTime", "ExpiresAt", "expires_at", "expiresAt"), c.now())
	if expiresAt == "" {
		if expSec := asFloat64(lookupAny(credsMap, "ExpiresIn", "expires_in", "expiresIn")); expSec > 0 {
			expiresAt = c.now().Add(time.Duration(expSec) * time.Second).UTC().Format(time.RFC3339)
		}
	}

	userMap := lookupMap(credsMap, "User", "user")
	userID := asFlexString(lookupAny(userMap, "Id", "id", "UserId", "userId", "user_id"))
	email := asFlexString(lookupAny(userMap, "Email", "email"))
	aliyunID := asFlexString(lookupAny(userMap, "AliyunId", "aliyunId", "aliyun_id", "Organization", "organization"))

	return &PollResult{
		Status: "complete",
		Credentials: &TokenCredentials{
			AccessToken:  accessToken,
			RefreshToken: refreshToken,
			ExpiresAt:    expiresAt,
			User: UserProfile{
				ID:       userID,
				Email:    email,
				AliyunID: aliyunID,
			},
		},
	}, nil
}

// PollDeviceToken polls /cli/device/token honoring interval, slow_down (+5s),
// transient-error exponential backoff, timeout, and context cancellation.
func (c *Client) PollDeviceToken(
	ctx context.Context,
	start *DeviceAuthStart,
	onStatus func(status string, interval int),
) (*TokenCredentials, error) {
	if start == nil {
		return nil, errors.New("device auth session is nil")
	}
	interval := start.Interval
	if interval <= 0 {
		interval = defaultPollInterval
	}
	expiresIn := start.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 300
	}
	deadline := c.now().Add(time.Duration(expiresIn) * time.Second)
	transientFailures := 0

	for c.now().Before(deadline) {
		wait := time.Duration(interval) * time.Second
		if transientFailures > 0 {
			wait = transientBackoff(wait, transientFailures)
		}
		remaining := deadline.Sub(c.now())
		if remaining <= 0 {
			break
		}
		if wait > remaining {
			wait = remaining
		}
		if err := c.sleep(ctx, wait); err != nil {
			return nil, err
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if !c.now().Before(deadline) {
			break
		}

		res, err := c.PollDeviceTokenOnce(ctx, start.ClientID, start.DeviceCode, start.CodeVerifier)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			var nonRetryable *nonRetryablePollError
			if errors.As(err, &nonRetryable) {
				log.Printf("[qianwen] device poll fatal error: %v", nonRetryable.err)
				return nil, nonRetryable.err
			}
			transientFailures++
			log.Printf("[qianwen] device poll transient error (attempt=%d): %v", transientFailures, err)
			continue
		}
		transientFailures = 0

		switch res.Status {
		case "complete", "completed", "success":
			if res.Credentials == nil || strings.TrimSpace(res.Credentials.AccessToken) == "" {
				return nil, errors.New("authorization completed without access token")
			}
			return res.Credentials, nil
		case "slow_down":
			interval += slowDownStepSeconds
			if onStatus != nil {
				onStatus("slow_down", interval)
			}
		case "expired_token", "expired":
			return nil, ErrDeviceExpired
		case "access_denied", "denied":
			return nil, ErrAccessDenied
		case "not_found", "invalid_token", "consumed", "failed":
			log.Printf("[qianwen] device poll terminal status: %s", res.Status)
			return nil, ErrDeviceSessionInvalid
		case "authorization_pending", "pending":
			if onStatus != nil {
				onStatus("pending", interval)
			}
		default:
			log.Printf("[qianwen] device poll unexpected status=%s", res.Status)
			if onStatus != nil {
				onStatus("pending", interval)
			}
		}
	}

	return nil, ErrDeviceExpired
}

func transientBackoff(base time.Duration, failures int) time.Duration {
	shift := failures - 1
	if shift > 3 {
		shift = 3
	}
	backoff := base * time.Duration(1<<shift)
	if backoff > maxBackoffInterval {
		return maxBackoffInterval
	}
	return backoff
}

// FetchAccountInfo verifies the primary token and fetches AliyunId / Email from /api/account/info.json.
func (c *Client) FetchAccountInfo(ctx context.Context, accessToken string) (*UserProfile, error) {
	if strings.TrimSpace(accessToken) == "" {
		return nil, ErrAuthRequired
	}
	endpoint := fmt.Sprintf("%s/api/account/info.json", c.apiBase())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.userAgent())
	req.Header.Set("Authorization", "Bearer "+accessToken)

	status, body, err := c.doRequest(req)
	if err != nil {
		return nil, err
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return nil, ErrAuthRequired
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("account info HTTP %d: %s", status, truncateSnippet(body))
	}

	root, err := decodeJSONMap(body)
	if err != nil {
		return nil, fmt.Errorf("failed to parse account info response: %w", err)
	}
	dataMap := lookupMap(root, "data", "Data")
	if dataMap == nil {
		return &UserProfile{}, nil
	}
	return &UserProfile{
		ID:       asFlexString(lookupAny(dataMap, "id", "Id", "userId")),
		AliyunID: asFlexString(lookupAny(dataMap, "aliyunId", "AliyunId", "aliyun_id")),
		Email:    asFlexString(lookupAny(dataMap, "email", "Email")),
	}, nil
}

// GenerateCLIAccessToken exchanges the primary access token for a derived cs-data cliAccessToken.
func (c *Client) GenerateCLIAccessToken(ctx context.Context, accessToken string) (string, error) {
	data, err := c.CallFlatAPI(ctx, accessToken, ProductModelStudioRegional, ActionGenerateCLIAccessToken, VersionGenerateCLIToken, map[string]any{})
	if err != nil {
		return "", err
	}
	var parsed struct {
		CLIAccessToken string `json:"cliAccessToken"`
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &parsed); err != nil {
			return "", fmt.Errorf("failed to parse derived token response: %w", err)
		}
	}
	tok := strings.TrimSpace(parsed.CLIAccessToken)
	if tok == "" || tok == accessToken {
		return "", errors.New("token issuance returned an invalid derived credential")
	}
	return tok, nil
}

// Logout best-effort revokes the current session on Qianwen auth gateway.
func (c *Client) Logout(ctx context.Context, accessToken string) error {
	if strings.TrimSpace(accessToken) == "" {
		return nil
	}
	_, err := c.CallFlatAPI(ctx, accessToken, ProductQianwenAuth, ActionLogout, "", map[string]any{})
	return err
}

// CallFlatAPI calls https://cli.qianwenai.com/data/v2/api.json with the primary Bearer token.
func (c *Client) CallFlatAPI(
	ctx context.Context,
	accessToken string,
	product string,
	action string,
	version string,
	params map[string]any,
) (json.RawMessage, error) {
	if strings.TrimSpace(accessToken) == "" {
		return nil, ErrAuthRequired
	}
	stringParams := make(map[string]string, len(params))
	for k, v := range params {
		switch val := v.(type) {
		case string:
			stringParams[k] = val
		case int:
			stringParams[k] = strconv.Itoa(val)
		case int64:
			stringParams[k] = strconv.FormatInt(val, 10)
		case float64:
			stringParams[k] = strconv.FormatFloat(val, 'f', -1, 64)
		case bool:
			stringParams[k] = strconv.FormatBool(val)
		default:
			encoded, err := json.Marshal(val)
			if err != nil {
				stringParams[k] = fmt.Sprint(val)
			} else {
				stringParams[k] = string(encoded)
			}
		}
	}

	payload := map[string]any{
		"product": product,
		"action":  action,
		"region":  DefaultRegion,
		"params":  stringParams,
	}
	if strings.TrimSpace(version) != "" {
		payload["version"] = version
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	endpoint := fmt.Sprintf("%s/data/v2/api.json", c.apiBase())
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.userAgent())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	status, respBody, err := c.doRequest(req)
	if err != nil {
		return nil, err
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return nil, ErrAuthRequired
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("flat API %s/%s HTTP %d: %s", product, action, status, truncateSnippet(respBody))
	}

	var env struct {
		Code            any             `json:"code"`
		Message         string          `json:"message"`
		SuccessResponse *bool           `json:"successResponse"`
		Data            json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(respBody, &env); err != nil {
		return nil, fmt.Errorf("invalid flat API response JSON: %w", err)
	}
	envCode := asFlexString(env.Code)
	if envCode != "200" {
		if isAuthFailureCode(envCode, env.Message) {
			return nil, ErrAuthRequired
		}
		msg := strings.TrimSpace(env.Message)
		if msg == "" {
			msg = "code=" + envCode
		}
		return nil, fmt.Errorf("gateway error (%s): %s", envCode, msg)
	}
	if product == ProductModelStudioRegional && action == ActionGenerateCLIAccessToken {
		if env.SuccessResponse == nil || !*env.SuccessResponse {
			return nil, errors.New("token issuance did not confirm success")
		}
	}
	return env.Data, nil
}

// CallCSDataAPI calls https://cs-data.qianwenai.com/cli/api.json using the derived cliAccessToken.
func (c *Client) CallCSDataAPI(
	ctx context.Context,
	cliAccessToken string,
	apiName string,
	data map[string]any,
) (json.RawMessage, error) {
	if strings.TrimSpace(cliAccessToken) == "" {
		return nil, ErrDerivedTokenExpired
	}

	q := url.Values{}
	q.Set("action", CSDataAction)
	q.Set("product", CSDataProduct)
	q.Set("api", apiName)
	endpoint := fmt.Sprintf("%s/cli/api.json?%s", c.csDataBase(), q.Encode())

	innerData := make(map[string]any, len(data)+1)
	for k, v := range data {
		innerData[k] = v
	}
	innerData["cornerstoneParam"] = map[string]any{
		"protocol":       "V2",
		"console":        "ONE_CONSOLE",
		"productCode":    "p_efm",
		"switchUserType": 3,
		"consoleSite":    "QIANWENAI",
	}
	paramsPayload := map[string]any{
		"Api":  apiName,
		"V":    "1.0",
		"Data": innerData,
	}
	paramsJSON, err := json.Marshal(paramsPayload)
	if err != nil {
		return nil, err
	}

	form := url.Values{}
	form.Set("params", string(paramsJSON))
	form.Set("region", DefaultRegion)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.userAgent())
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Authorization", "Bearer "+cliAccessToken)

	status, respBody, err := c.doRequest(req)
	if err != nil {
		return nil, err
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return nil, ErrDerivedTokenExpired
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("cs-data API HTTP %d: %s", status, truncateSnippet(respBody))
	}

	var env struct {
		Code            any    `json:"code"`
		Message         string `json:"message"`
		SuccessResponse *bool  `json:"successResponse"`
		Data            *struct {
			Success   bool   `json:"success"`
			ErrorCode string `json:"errorCode"`
			ErrorMsg  string `json:"errorMessage"`
			DataV2    *struct {
				Ret  []string        `json:"ret"`
				Data json.RawMessage `json:"data"`
			} `json:"DataV2"`
		} `json:"data"`
	}
	if err := json.Unmarshal(respBody, &env); err != nil {
		return nil, fmt.Errorf("invalid cs-data response JSON: %w", err)
	}
	envCode := asFlexString(env.Code)
	if envCode != "200" || env.SuccessResponse == nil || !*env.SuccessResponse {
		if isAuthFailureCode(envCode, env.Message) {
			return nil, ErrDerivedTokenExpired
		}
		return nil, fmt.Errorf("cs-data gateway rejected request (code=%s)", envCode)
	}
	if env.Data == nil {
		return nil, errors.New("invalid cs-data gateway envelope")
	}
	if !env.Data.Success && env.Data.ErrorCode == "BailianGateway.Login.NotLogined" {
		return nil, ErrDerivedTokenExpired
	}
	if !env.Data.Success || env.Data.ErrorCode != "" {
		return nil, fmt.Errorf("cs-data gateway error: %s", env.Data.ErrorCode)
	}
	if env.Data.DataV2 == nil || len(env.Data.DataV2.Ret) == 0 || !strings.HasPrefix(env.Data.DataV2.Ret[0], "SUCCESS::") {
		return nil, errors.New("cs-data response missing successful ret")
	}

	var biz struct {
		Code    string `json:"code"`
		Success bool   `json:"success"`
	}
	if err := json.Unmarshal(env.Data.DataV2.Data, &biz); err != nil {
		return nil, fmt.Errorf("invalid cs-data business envelope: %w", err)
	}
	if biz.Code != "SUCCESS" || !biz.Success {
		return nil, fmt.Errorf("cs-data business failure (code=%s)", biz.Code)
	}

	return env.Data.DataV2.Data, nil
}

// FetchTokenPlanUsage retrieves both Personal and Team Token Plan status & real-time usage.
// It automatically issues/renews the derived cliAccessToken on NotLogined / 401 and retries once.
func (c *Client) FetchTokenPlanUsage(
	ctx context.Context,
	creds *cred.QianwenCredentialPayload,
	onCredsUpdated func(*cred.QianwenCredentialPayload),
) (*storage.QianwenQuotaSnapshot, error) {
	if creds == nil || creds.IsExpired(c.now()) {
		return nil, ErrAuthRequired
	}

	var derivedMu sync.Mutex
	currentDerived := strings.TrimSpace(creds.CLIAccessToken)

	ensureDerived := func(forceRefresh bool, prevToken string) (string, error) {
		derivedMu.Lock()
		defer derivedMu.Unlock()

		if !forceRefresh && currentDerived != "" {
			return currentDerived, nil
		}
		if forceRefresh && currentDerived != "" && currentDerived != prevToken {
			return currentDerived, nil
		}

		tok, err := c.GenerateCLIAccessToken(ctx, creds.AccessToken)
		if err != nil {
			return "", err
		}
		currentDerived = tok
		creds.CLIAccessToken = tok
		if onCredsUpdated != nil {
			onCredsUpdated(creds)
		}
		return tok, nil
	}

	callCSDataWithRefresh := func(apiName string, data map[string]any) (json.RawMessage, error) {
		tok, err := ensureDerived(false, "")
		if err != nil {
			return nil, err
		}
		res, err := c.CallCSDataAPI(ctx, tok, apiName, data)
		if errors.Is(err, ErrDerivedTokenExpired) {
			newTok, refreshErr := ensureDerived(true, tok)
			if refreshErr != nil {
				return nil, refreshErr
			}
			return c.CallCSDataAPI(ctx, newTok, apiName, data)
		}
		return res, err
	}

	var (
		personalPlan *storage.QianwenPersonalPlan
		personalErr  error
		teamPlan     *storage.QianwenTeamPlan
		teamErr      error
		wg           sync.WaitGroup
	)

	wg.Add(2)
	go func() {
		defer wg.Done()
		personalPlan, personalErr = c.fetchPersonalTokenPlan(ctx, callCSDataWithRefresh)
	}()
	go func() {
		defer wg.Done()
		teamPlan, teamErr = c.fetchTeamTokenPlan(ctx, creds.AccessToken)
	}()
	wg.Wait()

	if errors.Is(personalErr, ErrAuthRequired) || errors.Is(teamErr, ErrAuthRequired) {
		return nil, ErrAuthRequired
	}

	snapshot := &storage.QianwenQuotaSnapshot{
		LastRefreshedAt: c.now().UTC().Format(time.RFC3339),
		Personal:        personalPlan,
		Team:            teamPlan,
	}

	hasPersonal := personalPlan != nil && personalPlan.Status == "active"
	hasTeam := teamPlan != nil && teamPlan.Status == "active"
	snapshot.HasSubscription = hasPersonal || hasTeam

	var errMsgs []string
	if personalErr != nil {
		errMsgs = append(errMsgs, "个人版查询失败: "+personalErr.Error())
	}
	if teamErr != nil {
		errMsgs = append(errMsgs, "团队版查询失败: "+teamErr.Error())
	}
	if len(errMsgs) > 0 && !snapshot.HasSubscription {
		snapshot.ErrorMessage = strings.Join(errMsgs, "；")
	}

	return snapshot, nil
}

func (c *Client) fetchPersonalTokenPlan(
	ctx context.Context,
	callCSData func(apiName string, data map[string]any) (json.RawMessage, error),
) (*storage.QianwenPersonalPlan, error) {
	var (
		subRaw   json.RawMessage
		subErr   error
		usageRaw json.RawMessage
		usageErr error
		cfgRaw   json.RawMessage
		cfgErr   error
		wg       sync.WaitGroup
	)

	wg.Add(3)
	go func() {
		defer wg.Done()
		subRaw, subErr = callCSData(APIPersonalSubscription, map[string]any{
			"commodityCode": CommodityPersonal,
		})
	}()
	go func() {
		defer wg.Done()
		usageRaw, usageErr = callCSData(APIPersonalUsage, map[string]any{})
	}()
	go func() {
		defer wg.Done()
		cfgRaw, cfgErr = callCSData(APIPersonalQuotaConfig, map[string]any{})
	}()
	wg.Wait()

	if subErr != nil {
		return nil, subErr
	}

	plan, err := parsePersonalSubscription(subRaw)
	if err != nil {
		return nil, err
	}
	if plan.Status != "active" {
		return plan, nil
	}

	var specQuotaCfg map[string]float64
	if cfgErr == nil && len(cfgRaw) > 0 {
		specQuotaCfg = parsePersonalQuotaConfig(cfgRaw, plan.SpecCode)
	}
	if usageErr == nil && len(usageRaw) > 0 {
		plan.Cycles = parsePersonalUsageCycles(usageRaw, specQuotaCfg)
	}

	return plan, nil
}

func parsePersonalSubscription(raw json.RawMessage) (*storage.QianwenPersonalPlan, error) {
	var env struct {
		Code    string           `json:"code"`
		Success bool             `json:"success"`
		Data    *json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, fmt.Errorf("invalid personal subscription response: %w", err)
	}
	if env.Data == nil || string(*env.Data) == "null" {
		return &storage.QianwenPersonalPlan{Status: "not_subscribed"}, nil
	}

	var data map[string]any
	if err := json.Unmarshal(*env.Data, &data); err != nil {
		return nil, fmt.Errorf("invalid personal subscription data: %w", err)
	}
	if len(data) == 0 {
		return &storage.QianwenPersonalPlan{Status: "not_subscribed"}, nil
	}

	status, _ := data["status"].(string)
	if status != "VALID" {
		return &storage.QianwenPersonalPlan{Status: "not_subscribed"}, nil
	}

	specCode, _ := data["specCode"].(string)
	instanceCode, _ := data["instanceCode"].(string)
	autoRenew, _ := data["autoRenewFlag"].(bool)
	remainingDays := int(asFloat64(data["remainingDays"]))
	startISO := millisToRFC3339(asFloat64(data["startTime"]))
	endISO := millisToRFC3339(asFloat64(data["endTime"]))

	planName := personalSpecNames[strings.ToLower(strings.TrimSpace(specCode))]
	if planName == "" && specCode != "" {
		planName = specCode
	}

	return &storage.QianwenPersonalPlan{
		Status:        "active",
		SpecCode:      specCode,
		PlanName:      planName,
		InstanceCode:  instanceCode,
		StartTime:     startISO,
		EndTime:       endISO,
		RemainingDays: remainingDays,
		AutoRenew:     autoRenew,
		Cycles:        []storage.QianwenUsageCycle{},
	}, nil
}

func parsePersonalQuotaConfig(raw json.RawMessage, specCode string) map[string]float64 {
	var env struct {
		Data map[string]map[string]float64 `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil || env.Data == nil {
		return nil
	}
	return env.Data[specCode]
}

type usageFieldSpec struct {
	cycle     string
	label     string
	pctKey    string
	resetKey  string
	cfgKey    string
	sortOrder int
}

var knownUsageFields = []usageFieldSpec{
	{cycle: "5h", label: "5 小时额度", pctKey: "per5HourPercentage", resetKey: "per5HourResetTime", cfgKey: "fiveHour", sortOrder: 1},
	{cycle: "weekly", label: "周度额度", pctKey: "per1WeekPercentage", resetKey: "per1WeekResetTime", cfgKey: "weekly", sortOrder: 2},
	{cycle: "monthly", label: "月度额度", pctKey: "per1MonthPercentage", resetKey: "per1MonthResetTime", cfgKey: "monthly", sortOrder: 3},
}

func parsePersonalUsageCycles(raw json.RawMessage, quotaCfg map[string]float64) []storage.QianwenUsageCycle {
	var env struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(raw, &env); err != nil || len(env.Data) == 0 {
		return []storage.QianwenUsageCycle{}
	}

	var cycles []storage.QianwenUsageCycle
	seenPctKeys := make(map[string]bool)

	for _, spec := range knownUsageFields {
		rawPct, ok := env.Data[spec.pctKey]
		if !ok || rawPct == nil {
			continue
		}
		seenPctKeys[spec.pctKey] = true
		cycle, valid := buildUsageCycle(spec.cycle, spec.label, rawPct, env.Data[spec.resetKey], quotaCfg[spec.cfgKey], quotaCfg != nil)
		if valid {
			cycles = append(cycles, cycle)
		}
	}

	// Dynamically parse any additional per*Percentage fields returned by the server.
	var extraKeys []string
	for k := range env.Data {
		if seenPctKeys[k] {
			continue
		}
		if strings.HasPrefix(k, "per") && strings.HasSuffix(k, "Percentage") && len(k) > len("perPercentage") {
			extraKeys = append(extraKeys, k)
		}
	}
	sort.Strings(extraKeys)
	for _, pctKey := range extraKeys {
		rawPct := env.Data[pctKey]
		if rawPct == nil {
			continue
		}
		suffix := strings.TrimSuffix(strings.TrimPrefix(pctKey, "per"), "Percentage")
		resetKey := "per" + suffix + "ResetTime"
		cycleID, label := normalizeDynamicCycle(suffix)
		cycle, valid := buildUsageCycle(cycleID, label, rawPct, env.Data[resetKey], 0, false)
		if valid {
			cycles = append(cycles, cycle)
		}
	}

	return cycles
}

func normalizeDynamicCycle(suffix string) (string, string) {
	lower := strings.ToLower(suffix)
	switch {
	case strings.Contains(lower, "hour"):
		num := strings.TrimSuffix(lower, "hour")
		num = strings.TrimSuffix(num, "s")
		if num != "" {
			return num + "h", num + " 小时额度"
		}
		return lower, suffix
	case strings.Contains(lower, "day"):
		num := strings.TrimSuffix(lower, "day")
		num = strings.TrimSuffix(num, "s")
		if num != "" {
			return num + "d", num + " 天额度"
		}
		return lower, suffix
	case strings.Contains(lower, "week"):
		return "weekly", "周度额度"
	case strings.Contains(lower, "month"):
		return "monthly", "月度额度"
	default:
		return lower, suffix + " 额度"
	}
}

func buildUsageCycle(
	cycleID string,
	label string,
	rawPct any,
	rawReset any,
	totalCfg float64,
	hasCfg bool,
) (storage.QianwenUsageCycle, bool) {
	ratio, ok := asStrictRatio(rawPct)
	if !ok {
		return storage.QianwenUsageCycle{}, false
	}
	usedPct := roundOneDecimal(clampFloat(ratio*100, 0, 100))
	remainingPct := roundOneDecimal(clampFloat((1-ratio)*100, 0, 100))
	resetISO := millisToRFC3339(asFloat64(rawReset))

	cycle := storage.QianwenUsageCycle{
		Cycle:               cycleID,
		Label:               label,
		UsedPercentage:      usedPct,
		RemainingPercentage: remainingPct,
		ResetTime:           resetISO,
	}
	if hasCfg && totalCfg > 0 {
		v := totalCfg
		cycle.TotalQuota = &v
	}
	return cycle, true
}

func (c *Client) fetchTeamTokenPlan(ctx context.Context, accessToken string) (*storage.QianwenTeamPlan, error) {
	var (
		frRaw    json.RawMessage
		frErr    error
		addonRaw json.RawMessage
		addonErr error
		seatRaw  json.RawMessage
		seatErr  error
		renewRaw json.RawMessage
		renewErr error
		wg       sync.WaitGroup
	)

	wg.Add(4)
	go func() {
		defer wg.Done()
		frRaw, frErr = c.CallFlatAPI(ctx, accessToken, ProductBssOpenAPIV3, ActionDescribeFrInstances, "", map[string]any{
			"Group":         "tokenPlan",
			"CommodityCode": CommodityTeam,
			"PageNum":       1,
			"PageSize":      100,
		})
	}()
	go func() {
		defer wg.Done()
		addonRaw, addonErr = c.CallFlatAPI(ctx, accessToken, ProductBssOpenAPIV3, ActionDescribeFrInstances, "", map[string]any{
			"Group":         "tokenPlan",
			"CommodityCode": CommodityTeamAddon,
			"PageNum":       1,
			"PageSize":      100,
		})
	}()
	go func() {
		defer wg.Done()
		seatRaw, seatErr = c.CallFlatAPI(ctx, accessToken, ProductBssOpenAPIV3, ActionGetSeatSummary, "", map[string]any{
			"productCode": CommodityTeam,
		})
	}()
	go func() {
		defer wg.Done()
		renewRaw, renewErr = c.CallFlatAPI(ctx, accessToken, ProductBssOpenAPI, ActionCheckTeamAutoRenewal, "", map[string]any{
			"CommodityCode": CommodityTeam,
		})
	}()
	wg.Wait()

	if errors.Is(frErr, ErrAuthRequired) || errors.Is(seatErr, ErrAuthRequired) {
		return nil, ErrAuthRequired
	}
	if frErr != nil && seatErr != nil {
		return nil, frErr
	}

	plan := &storage.QianwenTeamPlan{
		Status:     "not_subscribed",
		SeatGroups: []storage.QianwenTeamSeatGroup{},
	}

	if frErr == nil && len(frRaw) > 0 {
		applyTeamFrInstances(plan, frRaw)
	}
	if addonErr == nil && len(addonRaw) > 0 {
		plan.AddonRemaining = parseAddonRemaining(addonRaw)
	}
	if seatErr == nil && len(seatRaw) > 0 {
		applySeatSubscriptionSummary(plan, seatRaw)
	}
	if renewErr == nil && len(renewRaw) > 0 {
		if ar := parseTeamAutoRenewal(renewRaw); ar != nil {
			plan.AutoRenew = ar
		}
	}

	if plan.Status != "active" && plan.AddonRemaining <= 0 && len(plan.SeatGroups) == 0 {
		return &storage.QianwenTeamPlan{Status: "not_subscribed"}, nil
	}
	return plan, nil
}

func applyTeamFrInstances(plan *storage.QianwenTeamPlan, raw json.RawMessage) {
	var resp struct {
		Data []struct {
			InstanceID            string `json:"InstanceId"`
			CommodityCode         string `json:"CommodityCode"`
			TemplateName          string `json:"TemplateName"`
			CommodityName         string `json:"CommodityName"`
			Status                any    `json:"Status"`
			StatusCode            string `json:"StatusCode"`
			CapacityTypeCode      string `json:"CapacityTypeCode"`
			InitCapacityBaseValue any    `json:"InitCapacityBaseValue"`
			CurrCapacityBaseValue any    `json:"CurrCapacityBaseValue"`
			PeriodCapacityBaseVal any    `json:"periodCapacityBaseValue"`
			StartTime             any    `json:"StartTime"`
			EndTime               any    `json:"EndTime"`
		} `json:"Data"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return
	}
	for _, item := range resp.Data {
		statusCode := item.StatusCode
		if statusCode == "" {
			switch st := item.Status.(type) {
			case string:
				statusCode = st
			case map[string]any:
				if c, ok := st["Code"].(string); ok {
					statusCode = c
				}
			}
		}
		if statusCode != "valid" {
			continue
		}
		plan.Status = "active"
		plan.InstanceID = item.InstanceID
		if name := strings.TrimSpace(item.TemplateName); name != "" {
			plan.PlanName = name
		} else if name := strings.TrimSpace(item.CommodityName); name != "" {
			plan.PlanName = name
		}
		if st := anyTimestampToRFC3339(item.StartTime); st != "" {
			plan.StartTime = st
		}
		if et := anyTimestampToRFC3339(item.EndTime); et != "" {
			plan.EndTime = et
		}
		total := asFloat64(item.InitCapacityBaseValue)
		curr := asFloat64(item.CurrCapacityBaseValue)
		if item.CapacityTypeCode == "periodMonthlyShift" && item.PeriodCapacityBaseVal != nil {
			curr = asFloat64(item.PeriodCapacityBaseVal)
		}
		if total > 0 && curr >= 0 && curr <= total {
			plan.TotalCredits = total
			plan.RemainingCredits = curr
			plan.UsedPercentage = roundOneDecimal((total - curr) / total * 100)
			plan.RemainingPercentage = roundOneDecimal(curr / total * 100)
		}
		break
	}
}

func parseAddonRemaining(raw json.RawMessage) float64 {
	var resp struct {
		Data []struct {
			Status                any `json:"Status"`
			StatusCode            string `json:"StatusCode"`
			CurrCapacityBaseValue any `json:"CurrCapacityBaseValue"`
		} `json:"Data"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return 0
	}
	var sum float64
	for _, item := range resp.Data {
		statusCode := item.StatusCode
		if statusCode == "" {
			switch st := item.Status.(type) {
			case string:
				statusCode = st
			case map[string]any:
				if c, ok := st["Code"].(string); ok {
					statusCode = c
				}
			}
		}
		if statusCode == "valid" {
			sum += asFloat64(item.CurrCapacityBaseValue)
		}
	}
	return sum
}

func applySeatSubscriptionSummary(plan *storage.QianwenTeamPlan, raw json.RawMessage) {
	var resp struct {
		Data *struct {
			PlanName              string `json:"PlanName"`
			StartTime             any    `json:"StartTime"`
			PeriodStart           any    `json:"PeriodStart"`
			EndTime               any    `json:"EndTime"`
			PeriodEnd             any    `json:"PeriodEnd"`
			RemainingDays         any    `json:"RemainingDays"`
			SubscriptionGroupList []struct {
				SpecType                   string `json:"SpecType"`
				SubscriptionTotalNumber    any    `json:"SubscriptionTotalNumber"`
				SubscriptionAssignedNumber any    `json:"SubscriptionAssignedNumber"`
				NextCycleFlushTime         any    `json:"NextCycleFlushTime"`
				TotalValue                 any    `json:"TotalValue"`
				SurplusValue               any    `json:"SurplusValue"`
				EquityList                 []struct {
					EquityType   string `json:"EquityType"`
					TotalValue   any    `json:"TotalValue"`
					SurplusValue any    `json:"SurplusValue"`
				} `json:"EquityList"`
			} `json:"SubscriptionGroupList"`
		} `json:"Data"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil || resp.Data == nil {
		return
	}
	d := resp.Data
	if name := strings.TrimSpace(d.PlanName); name != "" {
		plan.PlanName = name
	}
	if st := anyTimestampToRFC3339(firstNonNil(d.StartTime, d.PeriodStart)); st != "" {
		plan.StartTime = st
	}
	if et := anyTimestampToRFC3339(firstNonNil(d.EndTime, d.PeriodEnd)); et != "" {
		plan.EndTime = et
	}
	if days := int(asFloat64(d.RemainingDays)); days > 0 {
		plan.RemainingDays = days
	}

	var totalSum, remSum float64
	var groups []storage.QianwenTeamSeatGroup
	var firstReset string

	for _, g := range d.SubscriptionGroupList {
		total := asFloat64(g.TotalValue)
		rem := asFloat64(g.SurplusValue)
		for _, eq := range g.EquityList {
			if eq.EquityType == "CREDITS" {
				total = asFloat64(eq.TotalValue)
				rem = asFloat64(eq.SurplusValue)
				break
			}
		}
		resetISO := anyTimestampToRFC3339(g.NextCycleFlushTime)
		if firstReset == "" && resetISO != "" {
			firstReset = resetISO
		}
		var usedPct, remPct float64
		if total > 0 {
			remPct = roundOneDecimal(clampFloat(rem/total*100, 0, 100))
			usedPct = roundOneDecimal(clampFloat((total-rem)/total*100, 0, 100))
		}
		totalSum += total
		remSum += rem
		groups = append(groups, storage.QianwenTeamSeatGroup{
			SpecType:            g.SpecType,
			Seats:               int(asFloat64(g.SubscriptionTotalNumber)),
			Assigned:            int(asFloat64(g.SubscriptionAssignedNumber)),
			TotalCredits:        total,
			RemainingCredits:    rem,
			UsedPercentage:      usedPct,
			RemainingPercentage: remPct,
			NextResetTime:       resetISO,
		})
	}

	if len(groups) > 0 {
		plan.Status = "active"
		plan.SeatGroups = groups
		if totalSum > 0 {
			plan.TotalCredits = totalSum
			plan.RemainingCredits = remSum
			plan.RemainingPercentage = roundOneDecimal(clampFloat(remSum/totalSum*100, 0, 100))
			plan.UsedPercentage = roundOneDecimal(clampFloat((totalSum-remSum)/totalSum*100, 0, 100))
		}
		if firstReset != "" {
			plan.ResetTime = firstReset
		}
	}
}

func parseTeamAutoRenewal(raw json.RawMessage) *bool {
	var resp struct {
		Data *struct {
			AutoRenewal any `json:"AutoRenewal"`
		} `json:"Data"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil || resp.Data == nil {
		return nil
	}
	switch v := resp.Data.AutoRenewal.(type) {
	case bool:
		return &v
	case float64:
		b := v != 0
		return &b
	default:
		return nil
	}
}

func (c *Client) doRequest(req *http.Request) (int, []byte, error) {
	resp, err := c.httpClient().Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, body, nil
}

func isAuthFailureCode(code, message string) bool {
	combined := strings.ToUpper(code + " " + message)
	return strings.Contains(combined, "AUTH") ||
		strings.Contains(combined, "NOTLOGIN") ||
		strings.Contains(combined, "NOT_LOGIN") ||
		strings.Contains(combined, "UNAUTHORIZED") ||
		strings.Contains(combined, "TOKEN_EXPIRED") ||
		strings.Contains(combined, "INVALID_TOKEN")
}

func truncateSnippet(body []byte) string {
	s := strings.TrimSpace(string(body))
	if len(s) > maxErrorBodySnippet {
		return s[:maxErrorBodySnippet] + "..."
	}
	return s
}

func asStrictRatio(v any) (float64, bool) {
	switch val := v.(type) {
	case float64:
		if math.IsNaN(val) || math.IsInf(val, 0) || val < 0 || val > personalUsageCycleMax {
			return 0, false
		}
		return val, true
	case int:
		f := float64(val)
		if f < 0 || f > personalUsageCycleMax {
			return 0, false
		}
		return f, true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(val), 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f < 0 || f > personalUsageCycleMax {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

func asFloat64(v any) float64 {
	switch val := v.(type) {
	case json.Number:
		f, err := val.Float64()
		if err != nil {
			return 0
		}
		return f
	case float64:
		return val
	case int:
		return float64(val)
	case int64:
		return float64(val)
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(val), 64)
		if err != nil {
			return 0
		}
		return f
	default:
		return 0
	}
}

func decodeJSONMap(body []byte) (map[string]any, error) {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil {
		return nil, err
	}
	if m == nil {
		return map[string]any{}, nil
	}
	return m, nil
}

func lookupAny(m map[string]any, keys ...string) any {
	if m == nil {
		return nil
	}
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

func lookupMap(m map[string]any, keys ...string) map[string]any {
	v := lookupAny(m, keys...)
	if v == nil {
		return nil
	}
	sub, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	return sub
}

func lookupBool(m map[string]any, keys ...string) (bool, bool) {
	v := lookupAny(m, keys...)
	if v == nil {
		return false, false
	}
	b, ok := v.(bool)
	return b, ok
}

func asFlexString(v any) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return strings.TrimSpace(val)
	case json.Number:
		return strings.TrimSpace(val.String())
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case int:
		return strconv.Itoa(val)
	case int64:
		return strconv.FormatInt(val, 10)
	case bool:
		return strconv.FormatBool(val)
	default:
		return ""
	}
}

func asTimestampRFC3339(v any, now time.Time) string {
	if v == nil {
		return ""
	}
	unixToRFC3339 := func(num float64) string {
		if num <= 0 || math.IsNaN(num) || math.IsInf(num, 0) {
			return ""
		}
		// Treat values >= 1e12 as milliseconds, >= 1e9 as seconds, smaller positive values as relative seconds.
		switch {
		case num >= 1e12:
			return time.UnixMilli(int64(num)).UTC().Format(time.RFC3339)
		case num >= 1e9:
			return time.Unix(int64(num), 0).UTC().Format(time.RFC3339)
		default:
			return now.Add(time.Duration(num) * time.Second).UTC().Format(time.RFC3339)
		}
	}

	switch val := v.(type) {
	case json.Number:
		if f, err := val.Float64(); err == nil {
			return unixToRFC3339(f)
		}
		return ""
	case float64:
		return unixToRFC3339(val)
	case int64:
		return unixToRFC3339(float64(val))
	case int:
		return unixToRFC3339(float64(val))
	case string:
		s := strings.TrimSpace(val)
		if s == "" {
			return ""
		}
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05"} {
			if t, err := time.Parse(layout, s); err == nil {
				return t.UTC().Format(time.RFC3339)
			}
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			return unixToRFC3339(f)
		}
		return s
	default:
		return ""
	}
}

func millisToRFC3339(ms float64) string {
	if ms <= 0 || math.IsNaN(ms) || math.IsInf(ms, 0) {
		return ""
	}
	return time.UnixMilli(int64(ms)).UTC().Format(time.RFC3339)
}

func anyTimestampToRFC3339(v any) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case float64:
		if val <= 0 {
			return ""
		}
		return time.UnixMilli(int64(val)).UTC().Format(time.RFC3339)
	case string:
		s := strings.TrimSpace(val)
		if s == "" {
			return ""
		}
		if ms, err := strconv.ParseInt(s, 10, 64); err == nil && ms > 0 {
			return time.UnixMilli(ms).UTC().Format(time.RFC3339)
		}
		if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t.UTC().Format(time.RFC3339)
		}
		return s
	default:
		return ""
	}
}

func firstNonNil(a, b any) any {
	if a != nil {
		return a
	}
	return b
}

func clampFloat(v, minV, maxV float64) float64 {
	if v < minV {
		return minV
	}
	if v > maxV {
		return maxV
	}
	return v
}

func roundOneDecimal(v float64) float64 {
	return math.Round(v*10) / 10
}
