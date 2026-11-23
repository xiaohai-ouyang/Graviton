package deepseek

import (
	"errors"

	"graviton/internal/storage"
)

const (
	DefaultBaseURL = "https://api.deepseek.com"
)

var (
	ErrAuthInvalid = errors.New("deepseek api key invalid or unauthorized")
)

// AccountDisplay is the sanitized frontend projection for a DeepSeek account (no raw API key).
type AccountDisplay struct {
	ID         string                          `json:"id"`
	Name       string                          `json:"name"`
	KeyPreview string                          `json:"keyPreview"`
	CreatedAt  string                          `json:"createdAt"`
	Balance    storage.DeepSeekBalanceSnapshot `json:"balance"`
}

// BatchRefreshResult summarizes a single account outcome during concurrent refresh.
type BatchRefreshResult struct {
	AccountID string          `json:"accountId"`
	Label     string          `json:"label"`
	Success   bool            `json:"success"`
	Account   *AccountDisplay `json:"account,omitempty"`
	Error     string          `json:"error,omitempty"`
}
