package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseSHA256Sums(t *testing.T) {
	content := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  Graviton-v0.2.0-windows-amd64-installer.exe\r\n" +
		"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB Graviton-v0.2.0-windows-amd64-portable.exe\n" +
		"garbage line\n" +
		"tooshort  file.exe\n"
	sums := ParseSHA256Sums(content)
	require.Len(t, sums, 2)
	assert.Equal(t, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", sums["Graviton-v0.2.0-windows-amd64-installer.exe"])
	assert.Equal(t, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", sums["Graviton-v0.2.0-windows-amd64-portable.exe"])
}

func TestVerifyFileSHA256(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "asset.exe")
	payload := []byte("graviton update payload")
	require.NoError(t, os.WriteFile(path, payload, 0644))
	digest := sha256.Sum256(payload)
	good := hex.EncodeToString(digest[:])

	assert.NoError(t, VerifyFileSHA256(path, good))
	assert.NoError(t, VerifyFileSHA256(path, "  "+good+"  "))

	// Tampered content fails.
	require.NoError(t, os.WriteFile(path, append(payload, 'x'), 0644))
	err := VerifyFileSHA256(path, good)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "SHA-256 校验不匹配")

	// Missing / malformed expected digest fails.
	assert.Error(t, VerifyFileSHA256(path, ""))
	assert.Error(t, VerifyFileSHA256(path, "abc"))
}