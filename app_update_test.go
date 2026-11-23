package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"graviton/internal/appservice"
	"graviton/internal/buildinfo"
	"graviton/internal/envmgr"
	"graviton/internal/updater"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type updateMockHooks struct {
	installCalls      atomic.Int32
	restartCalls      atomic.Int32
	quitCalls         atomic.Int32
	mu                sync.Mutex
	lastInstallParams updater.InstallParams
	lastRestartParams updater.RestartParams
	installErr        error
	restartErr        error
}

// newReadyUpdateApp builds a test App whose updater is already in ready state,
// backed by an httptest release server serving the given payload and mocked install/restart/quit hooks.
func newReadyUpdateApp(t *testing.T, channel string) (*App, *httptest.Server, *updateMockHooks) {
	t.Helper()
	app := newTestApp(t)
	hooks := &updateMockHooks{}
	app.installUpdateFn = func(p updater.InstallParams) error {
		hooks.installCalls.Add(1)
		hooks.mu.Lock()
		hooks.lastInstallParams = p
		err := hooks.installErr
		hooks.mu.Unlock()
		return err
	}
	app.launchRestartFn = func(p updater.RestartParams) error {
		hooks.restartCalls.Add(1)
		hooks.mu.Lock()
		hooks.lastRestartParams = p
		err := hooks.restartErr
		hooks.mu.Unlock()
		return err
	}
	app.quitAppFn = func() {
		hooks.quitCalls.Add(1)
	}

	payload := []byte("fake installer payload")
	digest := sha256.Sum256(payload)
	tag := "v0.1.0-rc.9"
	assetName := fmt.Sprintf("Graviton-%s-windows-amd64-portable.exe", tag)
	sums := hex.EncodeToString(digest[:]) + "  " + assetName + "\n"

	var srvURL string
	mux := http.NewServeMux()
	writeRelease := func(w http.ResponseWriter, single bool) {
		rel := map[string]any{
			"tag_name":     tag,
			"name":         "Graviton " + tag,
			"body":         "- 更新内容",
			"html_url":     "https://github.com/xiaohai-ouyang/Graviton/releases/tag/" + tag,
			"published_at": "2026-11-20T00:00:00Z",
			"prerelease":   true,
			"assets": []map[string]any{
				{"name": assetName, "size": len(payload), "browser_download_url": srvURL + "/download/" + assetName},
				{"name": "SHA256SUMS.txt", "size": len(sums), "browser_download_url": srvURL + "/download/SHA256SUMS.txt"},
			},
		}
		if single {
			_ = json.NewEncoder(w).Encode(rel)
		} else {
			_ = json.NewEncoder(w).Encode([]any{rel})
		}
	}
	mux.HandleFunc("/repos/xiaohai-ouyang/Graviton/releases/latest", func(w http.ResponseWriter, r *http.Request) { writeRelease(w, true) })
	mux.HandleFunc("/repos/xiaohai-ouyang/Graviton/releases", func(w http.ResponseWriter, r *http.Request) { writeRelease(w, false) })
	mux.HandleFunc("/download/", func(w http.ResponseWriter, r *http.Request) {
		if filepath.Base(r.URL.Path) == "SHA256SUMS.txt" {
			_, _ = w.Write([]byte(sums))
			return
		}
		_, _ = w.Write(payload)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	srvURL = srv.URL

	info := buildinfo.AppInfo{Version: "0.1.0-rc.8", Channel: channel}
	m := updater.NewManager(info, "", app.storageMgr.BaseDir(), updater.Settings{AutoCheckEnabled: true}, nil, nil)
	// Empty exePath + rc channel detects portable; dev channel detects dev.
	m.SetTestingOverrides(srv.URL, "")
	app.updater = m

	state, err := m.Check(context.Background(), true)
	require.NoError(t, err)
	require.Equal(t, updater.StatusReady, state.Status)
	return app, srv, hooks
}

func TestInstallUpdate_TransitionsToInstalledWithoutQuitting(t *testing.T) {
	app, _, hooks := newReadyUpdateApp(t, buildinfo.ChannelRC)

	state, err := app.InstallUpdate()
	require.NoError(t, err)
	assert.Equal(t, updater.StatusInstalled, state.Status)
	assert.True(t, state.PendingRestart)
	assert.Equal(t, int32(1), hooks.installCalls.Load())
	assert.Equal(t, int32(0), hooks.restartCalls.Load())
	assert.Equal(t, int32(0), hooks.quitCalls.Load())

	hooks.mu.Lock()
	assert.Equal(t, updater.ModePortable, hooks.lastInstallParams.Mode)
	assert.NotEmpty(t, hooks.lastInstallParams.DownloadedFile)
	assert.NotEmpty(t, hooks.lastInstallParams.ExePath)
	hooks.mu.Unlock()

	// Pre-update version must already be persisted so even a manual restart shows the notice.
	sf, _, err := app.storageMgr.LoadSettings()
	require.NoError(t, err)
	assert.Equal(t, app.GetAppInfo().Version, sf.UpdatedFromVersion)
}

func TestInstallUpdate_FailureOrCancelRevertsToReady(t *testing.T) {
	app, _, hooks := newReadyUpdateApp(t, buildinfo.ChannelRC)
	hooks.installErr = updater.ErrInstallCancelled

	state, err := app.InstallUpdate()
	require.Error(t, err)
	var appErr *appservice.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, "UPDATE_INSTALL_CANCELLED", appErr.Code)
	assert.Equal(t, updater.StatusReady, state.Status)
	assert.False(t, state.PendingRestart)
	assert.Equal(t, int32(0), hooks.quitCalls.Load())

	hooks.mu.Lock()
	hooks.installErr = errors.New("mock install failure")
	hooks.mu.Unlock()
	state, err = app.InstallUpdate()
	require.Error(t, err)
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, "UPDATE_INSTALL_FAILED", appErr.Code)
	assert.Equal(t, updater.StatusReady, state.Status)
}

func TestRestartToApplyUpdate_RejectsBeforeInstall(t *testing.T) {
	app, _, hooks := newReadyUpdateApp(t, buildinfo.ChannelRC)

	_, err := app.RestartToApplyUpdate()
	require.Error(t, err)
	var appErr *appservice.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, "UPDATE_NOT_INSTALLED", appErr.Code)
	assert.Equal(t, int32(0), hooks.restartCalls.Load())
	assert.Equal(t, int32(0), hooks.quitCalls.Load())
}

func TestRestartToApplyUpdate_BusyDefersWithReasons(t *testing.T) {
	app, _, hooks := newReadyUpdateApp(t, buildinfo.ChannelRC)
	app.procMgr = envmgr.NewProcessManager(envmgr.RunnerCallbacks{})

	// Installing succeeds even while account operations are busy.
	app.mu.Lock()
	app.switchingIDs["acc-1"] = true
	app.mu.Unlock()

	state, err := app.InstallUpdate()
	require.NoError(t, err)
	require.Equal(t, updater.StatusInstalled, state.Status)

	// Requesting restart while busy defers to waiting_idle.
	state, err = app.RestartToApplyUpdate()
	require.NoError(t, err)
	assert.Equal(t, updater.StatusWaitingIdle, state.Status)
	assert.True(t, state.PendingRestart)
	assert.NotEmpty(t, state.BusyReasons)

	// Still busy: idle hook keeps waiting and refreshes reasons.
	app.onPotentialIdleForUpdate()
	assert.Equal(t, updater.StatusWaitingIdle, app.updater.State().Status)
	assert.Equal(t, int32(0), hooks.restartCalls.Load())

	// Release the account operation: the idle hook must fire the restart immediately.
	app.mu.Lock()
	delete(app.switchingIDs, "acc-1")
	app.mu.Unlock()
	app.onPotentialIdleForUpdate()
	assert.Equal(t, int32(1), hooks.restartCalls.Load())
	assert.Equal(t, int32(1), hooks.quitCalls.Load())
	hooks.mu.Lock()
	assert.NotEmpty(t, hooks.lastRestartParams.ExePath)
	hooks.mu.Unlock()
}

func TestOnPotentialIdleForUpdate_ConcurrentCallsRestartOnlyOnce(t *testing.T) {
	app, _, hooks := newReadyUpdateApp(t, buildinfo.ChannelRC)
	_, err := app.InstallUpdate()
	require.NoError(t, err)

	app.mu.Lock()
	app.switchingIDs["acc-1"] = true
	app.mu.Unlock()

	_, err = app.RestartToApplyUpdate()
	require.NoError(t, err)
	require.Equal(t, updater.StatusWaitingIdle, app.updater.State().Status)

	app.mu.Lock()
	delete(app.switchingIDs, "acc-1")
	app.mu.Unlock()

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			app.onPotentialIdleForUpdate()
		}()
	}
	wg.Wait()

	assert.Equal(t, int32(1), hooks.restartCalls.Load())
	assert.Equal(t, int32(1), hooks.quitCalls.Load())
}

func TestRestartToApplyUpdate_LaunchFailureRevertsToInstalled(t *testing.T) {
	app, _, hooks := newReadyUpdateApp(t, buildinfo.ChannelRC)
	_, err := app.InstallUpdate()
	require.NoError(t, err)

	hooks.restartErr = errors.New("mock restart launch error")
	_, err = app.RestartToApplyUpdate()
	require.Error(t, err)
	var appErr *appservice.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, "UPDATE_LAUNCH_FAILED", appErr.Code)
	assert.Equal(t, updater.StatusInstalled, app.updater.State().Status)
	assert.True(t, app.updater.State().PendingRestart)
	assert.Equal(t, int32(0), hooks.quitCalls.Load())
}

func TestCancelDeferredUpdate_IdleDoesNotRestart(t *testing.T) {
	app, _, hooks := newReadyUpdateApp(t, buildinfo.ChannelRC)
	_, err := app.InstallUpdate()
	require.NoError(t, err)

	app.mu.Lock()
	app.switchingIDs["acc-1"] = true
	app.mu.Unlock()

	state, err := app.RestartToApplyUpdate()
	require.NoError(t, err)
	require.Equal(t, updater.StatusWaitingIdle, state.Status)

	cancelled := app.CancelDeferredUpdate()
	assert.Equal(t, updater.StatusInstalled, cancelled.Status)
	assert.True(t, cancelled.PendingRestart)
	assert.Empty(t, cancelled.BusyReasons)

	app.mu.Lock()
	delete(app.switchingIDs, "acc-1")
	app.mu.Unlock()
	app.onPotentialIdleForUpdate()
	assert.Equal(t, updater.StatusInstalled, app.updater.State().Status, "cancelled reservation must not auto-restart")
	assert.Equal(t, int32(0), hooks.restartCalls.Load())
}

func TestInstallUpdate_DevModeRejected(t *testing.T) {
	app, _, hooks := newReadyUpdateApp(t, buildinfo.ChannelDev)

	_, err := app.InstallUpdate()
	require.Error(t, err)
	var appErr *appservice.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, "UPDATE_DEV_MODE", appErr.Code)
	assert.Equal(t, updater.StatusReady, app.updater.State().Status)
	assert.Equal(t, int32(0), hooks.installCalls.Load())
}

func TestOpenReleasePage_RestrictedToProjectRepo(t *testing.T) {
	app := newTestApp(t)
	assert.Error(t, app.OpenReleasePage("https://evil.example.com/x"))
	assert.Error(t, app.OpenReleasePage("https://github.com/other/repo/releases"))
	// Allowed URL with nil ctx is a no-op success.
	assert.NoError(t, app.OpenReleasePage("https://github.com/xiaohai-ouyang/Graviton/releases/tag/v0.1.0"))
}

func TestGetUpdateBusyReasons(t *testing.T) {
	app := newTestApp(t)
	assert.Empty(t, app.getUpdateBusyReasons())

	app.mu.Lock()
	app.refreshingAll = true
	app.mu.Unlock()
	reasons := app.getUpdateBusyReasons()
	require.Len(t, reasons, 1)
	assert.Contains(t, reasons[0], "账号操作")
}
