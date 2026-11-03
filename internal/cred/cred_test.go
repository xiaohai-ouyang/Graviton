package cred

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCredential_Lifecycle(t *testing.T) {
	testTarget := "CodeTool/Antigravity/test-unit-account-123"
	defer func() {
		_ = DeleteCredential(testTarget)
	}()

	payload := &CredentialPayload{
		Token: TokenInfo{
			AccessToken:  "test-access-token",
			TokenType:    "Bearer",
			RefreshToken: "test-refresh-token",
			Expiry:       time.Now().Add(1 * time.Hour).Format(time.RFC3339Nano),
			ExpiresIn:    3600,
		},
		AuthMethod:   "consumer",
		IDTokenEmail: "test@example.com",
		ProjectID:    "test-project-123",
	}

	// Write
	err := WriteCredential(testTarget, "test@example.com", payload)
	require.NoError(t, err)

	// Read
	readBack, err := ReadCredential(testTarget)
	require.NoError(t, err)
	assert.Equal(t, "test-access-token", readBack.Token.AccessToken)
	assert.Equal(t, "test-refresh-token", readBack.Token.RefreshToken)
	assert.Equal(t, "test@example.com", readBack.IDTokenEmail)
	assert.Equal(t, "test-project-123", readBack.ProjectID)

	// Expiry check
	assert.False(t, readBack.NeedsRefresh(5*time.Minute))
	assert.True(t, readBack.NeedsRefresh(2*time.Hour))

	// Delete
	err = DeleteCredential(testTarget)
	require.NoError(t, err)

	// Read after delete should return ErrNotFound
	_, err = ReadCredential(testTarget)
	assert.ErrorIs(t, err, ErrNotFound)
}
