package updater

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeMirrorURL(t *testing.T) {
	got, err := NormalizeMirrorURL("")
	require.NoError(t, err)
	assert.Equal(t, "", got)

	got, err = NormalizeMirrorURL("  https://gh-proxy.com  ")
	require.NoError(t, err)
	assert.Equal(t, "https://gh-proxy.com/", got)

	got, err = NormalizeMirrorURL("https://gh-proxy.com/")
	require.NoError(t, err)
	assert.Equal(t, "https://gh-proxy.com/", got)

	got, err = NormalizeMirrorURL("http://127.0.0.1:8080/prefix/")
	require.NoError(t, err)
	assert.Equal(t, "http://127.0.0.1:8080/prefix/", got)

	for _, bad := range []string{"ftp://x.com", "gh-proxy.com", "https://", "not a url"} {
		_, err := NormalizeMirrorURL(bad)
		assert.Error(t, err, "expected rejection for %q", bad)
	}
}

func TestApplyMirror(t *testing.T) {
	ghURL := "https://github.com/xiaohai-ouyang/Graviton/releases/download/v0.2.0/Graviton-v0.2.0-windows-amd64-portable.exe"

	assert.Equal(t, ghURL, ApplyMirror(ghURL, ""))
	assert.Equal(t, "https://gh-proxy.com/"+ghURL, ApplyMirror(ghURL, "https://gh-proxy.com/"))

	// Non-GitHub URLs pass through even with a mirror configured.
	apiURL := "https://api.github.com/repos/x/y/releases/latest"
	assert.Equal(t, apiURL, ApplyMirror(apiURL, "https://gh-proxy.com/"))
	other := "https://example.com/file.exe"
	assert.Equal(t, other, ApplyMirror(other, "https://gh-proxy.com/"))
}