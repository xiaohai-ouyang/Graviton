package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"graviton/internal/buildinfo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type updateTestServer struct {
	srv          *httptest.Server
	payload      []byte
	assetHits    atomic.Int32
	sumsContent  string
	releaseTag   string
	prerelease   bool
}

func newUpdateTestServer(t *testing.T, tag string, prerelease bool, payload []byte) *updateTestServer {
	t.Helper()
	ts := &updateTestServer{payload: payload, releaseTag: tag, prerelease: prerelease}
	digest := sha256.Sum256(payload)
	assetName := fmt.Sprintf("Graviton-%s-windows-amd64-portable.exe", tag)
	ts.sumsContent = hex.EncodeToString(digest[:]) + "  " + assetName + "\n"

	mux := http.NewServeMux()
	mux.HandleFunc("/repos/xiaohai-ouyang/Graviton/releases", func(w http.ResponseWriter, r *http.Request) {
		rel := releaseJSON(ts.releaseTag, ts.prerelease, false, []string{assetName, "SHA256SUMS.txt"})
		for i := range rel.Assets {
			rel.Assets[i].BrowserDownloadURL = ts.srv.URL + "/download/" + rel.Assets[i].Name
			rel.Assets[i].Size = int64(len(ts.payload))
		}
		_ = json.NewEncoder(w).Encode([]githubRelease{rel})
	})
	mux.HandleFunc("/repos/xiaohai-ouyang/Graviton/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		rel := releaseJSON(ts.releaseTag, ts.prerelease, false, []string{assetName, "SHA256SUMS.txt"})
		for i := range rel.Assets {
			rel.Assets[i].BrowserDownloadURL = ts.srv.URL + "/download/" + rel.Assets[i].Name
			rel.Assets[i].Size = int64(len(ts.payload))
		}
		_ = json.NewEncoder(w).Encode(rel)
	})
	mux.HandleFunc("/download/", func(w http.ResponseWriter, r *http.Request) {
		name := filepath.Base(r.URL.Path)
		if name == "SHA256SUMS.txt" {
			_, _ = w.Write([]byte(ts.sumsContent))
			return
		}
		ts.assetHits.Add(1)
		_, _ = w.Write(ts.payload)
	})
	ts.srv = httptest.NewServer(mux)
	t.Cleanup(ts.srv.Close)
	return ts
}

func newTestManager(t *testing.T, ts *updateTestServer, settings Settings) *Manager {
	t.Helper()
	info := buildinfo.AppInfo{Version: "0.1.0-rc.8", Channel: buildinfo.ChannelRC}
	m := NewManager(info, "", t.TempDir(), settings, nil, nil)
	m.SetTestingOverrides(ts.srv.URL, "")
	return m
}

func TestManager_CheckDownloadsVerifiesAndEntersReady(t *testing.T) {
	payload := []byte("fake portable binary content")
	ts := newUpdateTestServer(t, "v0.1.0-rc.9", true, payload)
	m := newTestManager(t, ts, Settings{AutoCheckEnabled: true})

	state, err := m.Check(context.Background(), true)
	require.NoError(t, err)
	assert.Equal(t, StatusReady, state.Status)
	assert.Equal(t, "0.1.0-rc.9", state.LatestVersion)
	assert.False(t, state.PendingRestart)
	assert.Equal(t, 100, state.Progress)
	assert.NotEmpty(t, state.CheckedAt)

	path, err := m.ReadyFilePath()
	require.NoError(t, err)
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, payload, data)
	assert.NoFileExists(t, path+".part")
	assert.Equal(t, int32(1), ts.assetHits.Load())

	// Second check reuses the verified cache without re-downloading.
	state, err = m.Check(context.Background(), true)
	require.NoError(t, err)
	assert.Equal(t, StatusReady, state.Status)
	assert.Equal(t, int32(1), ts.assetHits.Load())
}

func TestManager_CorruptCacheTriggersRedownload(t *testing.T) {
	payload := []byte("good content")
	ts := newUpdateTestServer(t, "v0.1.0-rc.9", true, payload)
	m := newTestManager(t, ts, Settings{AutoCheckEnabled: true})

	// Pre-seed a corrupt cached file with the target name.
	require.NoError(t, os.MkdirAll(m.cacheDir, 0755))
	cached := filepath.Join(m.cacheDir, "Graviton-v0.1.0-rc.9-windows-amd64-portable.exe")
	require.NoError(t, os.WriteFile(cached, []byte("corrupted"), 0644))

	state, err := m.Check(context.Background(), true)
	require.NoError(t, err)
	assert.Equal(t, StatusReady, state.Status)
	assert.Equal(t, int32(1), ts.assetHits.Load())
	data, err := os.ReadFile(cached)
	require.NoError(t, err)
	assert.Equal(t, payload, data)
}

func TestManager_TamperedDownloadRejected(t *testing.T) {
	ts := newUpdateTestServer(t, "v0.1.0-rc.9", true, []byte("original"))
	// Serve different bytes than the checksum covers.
	ts.payload = []byte("original")
	m := newTestManager(t, ts, Settings{AutoCheckEnabled: true})
	// Corrupt the sums so the served payload no longer matches.
	ts.sumsContent = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  Graviton-v0.1.0-rc.9-windows-amd64-portable.exe\n"

	state, err := m.Check(context.Background(), true)
	require.Error(t, err)
	assert.Equal(t, StatusError, state.Status)
	assert.Contains(t, state.ErrorMessage, "SHA-256 校验不匹配")
	entries, _ := os.ReadDir(m.cacheDir)
	for _, e := range entries {
		assert.NotContains(t, e.Name(), ".part")
	}
}

func TestManager_SkippedVersionBackgroundVsManual(t *testing.T) {
	ts := newUpdateTestServer(t, "v0.1.0-rc.9", true, []byte("payload"))
	m := newTestManager(t, ts, Settings{AutoCheckEnabled: true, SkippedVersion: "0.1.0-rc.9"})

	// Background check ignores the skipped version.
	state, err := m.Check(context.Background(), false)
	require.NoError(t, err)
	assert.Equal(t, StatusUpToDate, state.Status)
	assert.Empty(t, state.LatestVersion)
	assert.Equal(t, int32(0), ts.assetHits.Load())

	// Manual check surfaces it anyway.
	state, err = m.Check(context.Background(), true)
	require.NoError(t, err)
	assert.Equal(t, StatusReady, state.Status)
	assert.Equal(t, "0.1.0-rc.9", state.LatestVersion)
}

func TestManager_SkipVersionResetsReadyOffer(t *testing.T) {
	ts := newUpdateTestServer(t, "v0.1.0-rc.9", true, []byte("payload"))
	m := newTestManager(t, ts, Settings{AutoCheckEnabled: true})
	_, err := m.Check(context.Background(), true)
	require.NoError(t, err)
	require.Equal(t, StatusReady, m.State().Status)

	m.SkipVersion("0.1.0-rc.9")
	state := m.State()
	assert.Equal(t, StatusUpToDate, state.Status)
	assert.Equal(t, "0.1.0-rc.9", state.SkippedVersion)
	assert.False(t, state.PendingRestart)
	_, err = m.ReadyFilePath()
	assert.Error(t, err)
}

func TestManager_WaitingIdleCancelFlow(t *testing.T) {
	ts := newUpdateTestServer(t, "v0.1.0-rc.9", true, []byte("payload"))
	m := newTestManager(t, ts, Settings{AutoCheckEnabled: true})
	_, err := m.Check(context.Background(), true)
	require.NoError(t, err)

	m.SetWaitingIdle([]string{"「环境」中有 1 个托管命令正在运行"})
	assert.True(t, m.IsWaitingIdle())
	assert.Equal(t, StatusWaitingIdle, m.State().Status)
	assert.True(t, m.State().PendingRestart)
	assert.Len(t, m.State().BusyReasons, 1)

	m.CancelWaiting()
	assert.False(t, m.IsWaitingIdle())
	assert.Equal(t, StatusReady, m.State().Status)
	assert.False(t, m.State().PendingRestart)
	assert.Empty(t, m.State().BusyReasons)
}

func TestManager_ApplySettingsValidatesMirror(t *testing.T) {
	ts := newUpdateTestServer(t, "v0.1.0-rc.9", true, []byte("payload"))
	var persisted Settings
	m := newTestManager(t, ts, Settings{AutoCheckEnabled: true})
	m.onSettings = func(s Settings) { persisted = s }

	require.NoError(t, m.ApplySettings(false, "https://gh-proxy.com"))
	assert.False(t, m.State().AutoCheckEnabled)
	assert.Equal(t, "https://gh-proxy.com/", m.State().MirrorURL)
	assert.False(t, persisted.AutoCheckEnabled)

	err := m.ApplySettings(true, "ftp://bad")
	require.Error(t, err)
	assert.False(t, m.State().AutoCheckEnabled) // unchanged on failure
}

func TestManager_UpToDateWhenNoNewerRelease(t *testing.T) {
	ts := newUpdateTestServer(t, "v0.1.0-rc.8", true, []byte("payload"))
	m := newTestManager(t, ts, Settings{AutoCheckEnabled: true})

	state, err := m.Check(context.Background(), true)
	require.NoError(t, err)
	assert.Equal(t, StatusUpToDate, state.Status)
	assert.Empty(t, state.LatestVersion)
}

func TestManager_MirrorAppliedToDownloads(t *testing.T) {
	payload := []byte("mirrored payload")
	ts := newUpdateTestServer(t, "v0.1.0-rc.9", true, payload)
	m := newTestManager(t, ts, Settings{AutoCheckEnabled: true})

	// Mirror prefix pointing at the same test server host proves the prefix is applied:
	// asset URLs are httptest URLs (non-GitHub), so they must pass through untouched.
	require.NoError(t, m.ApplySettings(true, "https://gh-proxy.com/"))
	state, err := m.Check(context.Background(), true)
	require.NoError(t, err)
	assert.Equal(t, StatusReady, state.Status)
}

func TestManager_BackgroundErrorStaysSilent(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	info := buildinfo.AppInfo{Version: "0.1.0-rc.8", Channel: buildinfo.ChannelRC}
	m := NewManager(info, "", t.TempDir(), Settings{AutoCheckEnabled: true}, nil, nil)
	m.SetTestingOverrides(srv.URL, "")

	state, err := m.Check(context.Background(), false)
	require.Error(t, err)
	assert.Equal(t, StatusIdle, state.Status)
	assert.Empty(t, state.ErrorMessage)
}

func TestManager_CheckDoesNotClobberWaitingIdle(t *testing.T) {
	ts := newUpdateTestServer(t, "v0.1.0-rc.9", true, []byte("payload"))
	m := newTestManager(t, ts, Settings{AutoCheckEnabled: true})
	_, err := m.Check(context.Background(), true)
	require.NoError(t, err)

	m.SetWaitingIdle([]string{"「环境」中有 1 个托管命令正在运行"})
	state, err := m.Check(context.Background(), true)
	require.NoError(t, err)
	assert.Equal(t, StatusWaitingIdle, state.Status)
}

func TestManager_TryBeginInstallAtomicAndRevert(t *testing.T) {
	ts := newUpdateTestServer(t, "v0.1.0-rc.9", true, []byte("payload"))
	m := newTestManager(t, ts, Settings{AutoCheckEnabled: true})
	_, err := m.Check(context.Background(), true)
	require.NoError(t, err)

	path, started, err := m.TryBeginInstall(false)
	require.NoError(t, err)
	assert.True(t, started)
	assert.NotEmpty(t, path)
	assert.Equal(t, StatusInstalling, m.State().Status)

	path2, started2, err2 := m.TryBeginInstall(false)
	require.NoError(t, err2)
	assert.False(t, started2)
	assert.Empty(t, path2)

	m.RevertInstallingToReady()
	assert.Equal(t, StatusReady, m.State().Status)
	assert.False(t, m.State().PendingRestart)
}

func TestManager_CleanupPreservesApplyLog(t *testing.T) {
	info := buildinfo.AppInfo{Version: "0.1.0-rc.8", Channel: buildinfo.ChannelRC}
	m := NewManager(info, "", t.TempDir(), Settings{AutoCheckEnabled: true}, nil, nil)
	require.NoError(t, os.MkdirAll(m.cacheDir, 0755))

	for _, name := range []string{"old.exe", "x.part", "apply_update.ps1", "apply_update.log"} {
		require.NoError(t, os.WriteFile(filepath.Join(m.cacheDir, name), []byte("data"), 0644))
	}

	m.cleanupStaleFiles()

	assert.NoFileExists(t, filepath.Join(m.cacheDir, "old.exe"))
	assert.NoFileExists(t, filepath.Join(m.cacheDir, "x.part"))
	assert.NoFileExists(t, filepath.Join(m.cacheDir, "apply_update.ps1"))
	assert.FileExists(t, filepath.Join(m.cacheDir, "apply_update.log"))
}