package cred

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	TargetPrefixGraviton       = "Graviton/Antigravity/"
	LegacyTargetPrefixCodeTool = "CodeTool/Antigravity/"
	TargetGeminiAntigravity    = "gemini:antigravity"
	DefaultUserName            = "antigravity"
)

// ErrNotFound indicates the credential was not found.
var ErrNotFound = errors.New("credential not found")

// TokenInfo matches the token JSON structure used by Antigravity.
type TokenInfo struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	RefreshToken string `json:"refresh_token"`
	Expiry       string `json:"expiry"`
	ExpiresIn    int64  `json:"expires_in"`
}

// CredentialPayload represents the JSON payload stored inside Windows Credential Manager.
type CredentialPayload struct {
	Token          TokenInfo `json:"token"`
	AuthMethod     string    `json:"auth_method"`
	IDTokenEmail   string    `json:"id_token_email,omitempty"`
	IDToken        string    `json:"id_token,omitempty"`
	ProjectID      string    `json:"project_id,omitempty"`
	OAuthClientKey string    `json:"oauth_client_key,omitempty"`
}

// BuildAccountTarget returns the target string for a Graviton managed account.
func BuildAccountTarget(accountID string) string {
	return TargetPrefixGraviton + accountID
}

// BuildLegacyCodeToolTarget returns the legacy CodeTool credential target string.
func BuildLegacyCodeToolTarget(accountID string) string {
	return LegacyTargetPrefixCodeTool + accountID
}

// ParseExpiry parses RFC3339 expiry string or returns zero time.
func (c *CredentialPayload) ParseExpiry() time.Time {
	if c.Token.Expiry == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339Nano, c.Token.Expiry)
	if err != nil {
		t, err = time.Parse(time.RFC3339, c.Token.Expiry)
	}
	if err != nil {
		return time.Time{}
	}
	return t
}

// NeedsRefresh returns true if token expires within skewDuration (e.g. 5 minutes).
func (c *CredentialPayload) NeedsRefresh(skew time.Duration) bool {
	t := c.ParseExpiry()
	if t.IsZero() {
		return true
	}
	return time.Now().Add(skew).After(t)
}

// ReadAccountCredential reads the independent credential for a Graviton account,
// transparently falling back to legacy CodeTool credentials and migrating on hit.
func ReadAccountCredential(accountID string) (*CredentialPayload, error) {
	payload, err := ReadCredential(BuildAccountTarget(accountID))
	if err == nil || !errors.Is(err, ErrNotFound) {
		return payload, err
	}
	legacyPayload, legacyErr := ReadCredential(BuildLegacyCodeToolTarget(accountID))
	if legacyErr != nil {
		return nil, err
	}
	// Best-effort copy to new Graviton namespace for future reads
	_ = WriteAccountCredential(accountID, legacyPayload)
	return legacyPayload, nil
}

// WriteAccountCredential writes the independent credential for a Graviton account.
func WriteAccountCredential(accountID string, payload *CredentialPayload) error {
	userName := payload.IDTokenEmail
	if userName == "" {
		userName = DefaultUserName
	}
	return WriteCredential(BuildAccountTarget(accountID), userName, payload)
}

// DeleteAccountCredential deletes the independent credential for a Graviton account
// as well as any legacy CodeTool credential entry.
func DeleteAccountCredential(accountID string) error {
	err := DeleteCredential(BuildAccountTarget(accountID))
	legacyErr := DeleteCredential(BuildLegacyCodeToolTarget(accountID))
	if errors.Is(err, ErrNotFound) && legacyErr == nil {
		return nil
	}
	return err
}

// ReadClientCredential reads the active Antigravity credential (gemini:antigravity).
func ReadClientCredential() (*CredentialPayload, error) {
	return ReadCredential(TargetGeminiAntigravity)
}

// WriteClientCredential writes the active Antigravity credential (gemini:antigravity).
func WriteClientCredential(payload *CredentialPayload) error {
	return WriteCredential(TargetGeminiAntigravity, DefaultUserName, payload)
}

// ExtractEmailFromIDToken extracts the email claim from a Google JWT ID token without network calls.
func ExtractEmailFromIDToken(idToken string) string {
	parts := strings.Split(idToken, ".")
	if len(parts) < 2 {
		return ""
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		payloadBytes, err = base64.URLEncoding.DecodeString(parts[1])
	}
	if err != nil {
		return ""
	}
	var claims struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(payloadBytes, &claims); err == nil {
		return claims.Email
	}
	return ""
}

// ReadCredential reads and decodes the JSON payload from the given target name.
func ReadCredential(target string) (*CredentialPayload, error) {
	raw, err := ReadRaw(target)
	if err != nil {
		return nil, err
	}
	var payload CredentialPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("failed to parse credential JSON: %w", err)
	}
	if payload.IDTokenEmail == "" && payload.IDToken != "" {
		payload.IDTokenEmail = ExtractEmailFromIDToken(payload.IDToken)
	}
	return &payload, nil
}

// WriteCredential serializes and writes the payload to Windows Credential Manager.
func WriteCredential(target string, userName string, payload *CredentialPayload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to serialize credential payload: %w", err)
	}
	return WriteRaw(target, userName, data)
}

