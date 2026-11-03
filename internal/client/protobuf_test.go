package client

import (
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProtobuf_OAuthInfoLifecycle(t *testing.T) {
	at := "ya29.test-access-token"
	rt := "1//test-refresh-token"
	expiry := int64(1700000000)
	email := "test@example.com"

	// 1. Create OAuthInfo
	encoded := CreateOAuthInfo(at, rt, expiry, true, "", email)
	require.NotEmpty(t, encoded)

	// 2. Decode OAuthInfo
	decAt, decRt, decExp, _, err := DecodeOAuthInfo(encoded)
	require.NoError(t, err)
	assert.Equal(t, at, decAt)
	assert.Equal(t, rt, decRt)
	assert.Equal(t, expiry, decExp)

	// 3. Create Unified State Entry
	stateB64 := CreateUnifiedStateEntry("oauthTokenInfoSentinelKey", encoded)
	require.NotEmpty(t, stateB64)

	rawState, err := base64.StdEncoding.DecodeString(stateB64)
	require.NoError(t, err)
	require.NotEmpty(t, rawState)

	// 4. Test Topic Entry and Removal
	topicData := CreateUnifiedTopicEntry("oauthTokenInfoSentinelKey", encoded)
	require.NotEmpty(t, topicData)

	cleaned, err := RemoveUnifiedTopicEntry(topicData, "oauthTokenInfoSentinelKey")
	require.NoError(t, err)
	assert.Empty(t, cleaned)
}

func TestProtobuf_MinimalUserStatus(t *testing.T) {
	email := "user@gmail.com"
	payload := CreateMinimalUserStatusPayload(email)
	require.NotEmpty(t, payload)

	entryB64 := CreateUnifiedStateEntry("userStatusSentinelKey", payload)
	require.NotEmpty(t, entryB64)
}
