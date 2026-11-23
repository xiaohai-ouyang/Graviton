package cred

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	TargetPrefixDeepSeek    = "Graviton/DeepSeek/"
	DefaultDeepSeekUserName = "deepseek"
)

// DeepSeekCredentialPayload represents a DeepSeek API key stored securely
// inside Windows Credential Manager.
type DeepSeekCredentialPayload struct {
	APIKey string `json:"api_key"`
}

// BuildDeepSeekTarget returns the Windows Credential Manager target string for a DeepSeek account.
func BuildDeepSeekTarget(accountID string) string {
	return TargetPrefixDeepSeek + accountID
}

// ReadDeepSeekCredential reads a DeepSeek credential from Windows Credential Manager.
func ReadDeepSeekCredential(accountID string) (*DeepSeekCredentialPayload, error) {
	raw, err := ReadRaw(BuildDeepSeekTarget(accountID))
	if err != nil {
		return nil, err
	}
	var payload DeepSeekCredentialPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("failed to parse deepseek credential JSON: %w", err)
	}
	return &payload, nil
}

// WriteDeepSeekCredential writes a DeepSeek credential into Windows Credential Manager.
func WriteDeepSeekCredential(accountID string, payload *DeepSeekCredentialPayload) error {
	if payload == nil || strings.TrimSpace(payload.APIKey) == "" {
		return fmt.Errorf("deepseek api key is empty")
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to serialize deepseek credential payload: %w", err)
	}
	return WriteRaw(BuildDeepSeekTarget(accountID), DefaultDeepSeekUserName, data)
}

// DeleteDeepSeekCredential removes a DeepSeek credential from Windows Credential Manager.
func DeleteDeepSeekCredential(accountID string) error {
	return DeleteRaw(BuildDeepSeekTarget(accountID))
}
