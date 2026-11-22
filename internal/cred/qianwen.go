package cred

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	TargetPrefixQianwen     = "Graviton/Qianwen/"
	DefaultQianwenUserName  = "qianwen"
)

// QianwenCredentialPayload represents Qianwen OAuth tokens and derived cs-data credential
// stored securely inside Windows Credential Manager.
type QianwenCredentialPayload struct {
	AccessToken    string `json:"access_token"`
	RefreshToken   string `json:"refresh_token,omitempty"`
	ExpiresAt      string `json:"expires_at"`
	CLIAccessToken string `json:"cli_access_token,omitempty"`
	ClientID       string `json:"client_id,omitempty"`
	UserID         string `json:"user_id,omitempty"`
	Email          string `json:"email,omitempty"`
	AliyunID       string `json:"aliyun_id,omitempty"`
}

// BuildQianwenTarget returns the Windows Credential Manager target string for a Qianwen account.
func BuildQianwenTarget(accountID string) string {
	return TargetPrefixQianwen + accountID
}

// ParseExpiry parses the RFC3339/RFC3339Nano expiry timestamp or returns the zero time.
func (c *QianwenCredentialPayload) ParseExpiry() time.Time {
	if c == nil || strings.TrimSpace(c.ExpiresAt) == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339Nano, c.ExpiresAt)
	if err != nil {
		t, err = time.Parse(time.RFC3339, c.ExpiresAt)
	}
	if err != nil {
		return time.Time{}
	}
	return t
}

// IsExpired reports whether the primary access token is missing or expired at the given instant.
func (c *QianwenCredentialPayload) IsExpired(now time.Time) bool {
	if c == nil || strings.TrimSpace(c.AccessToken) == "" {
		return true
	}
	exp := c.ParseExpiry()
	if exp.IsZero() {
		return false
	}
	return !now.Before(exp)
}

// ReadQianwenCredential reads a Qianwen credential from Windows Credential Manager.
func ReadQianwenCredential(accountID string) (*QianwenCredentialPayload, error) {
	raw, err := ReadRaw(BuildQianwenTarget(accountID))
	if err != nil {
		return nil, err
	}
	var payload QianwenCredentialPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("failed to parse qianwen credential JSON: %w", err)
	}
	return &payload, nil
}

// WriteQianwenCredential writes a Qianwen credential into Windows Credential Manager.
func WriteQianwenCredential(accountID string, payload *QianwenCredentialPayload) error {
	if payload == nil {
		return fmt.Errorf("qianwen credential payload is nil")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to serialize qianwen credential payload: %w", err)
	}
	userName := strings.TrimSpace(payload.AliyunID)
	if userName == "" {
		userName = strings.TrimSpace(payload.Email)
	}
	if userName == "" {
		userName = DefaultQianwenUserName
	}
	return WriteRaw(BuildQianwenTarget(accountID), userName, data)
}

// DeleteQianwenCredential removes a Qianwen credential from Windows Credential Manager.
func DeleteQianwenCredential(accountID string) error {
	return DeleteRaw(BuildQianwenTarget(accountID))
}
