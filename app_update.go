package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"graviton/internal/appservice"
	"graviton/internal/storage"
	"graviton/internal/updater"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// initUpdater wires the update manager in the main process only (never the widget).
func (a *App) initUpdater() {
	if a.isWidget || a.storageMgr == nil {
		return
	}
	info := a.GetAppInfo()

	sf, _, err := a.storageMgr.LoadSettings()
	if err != nil || sf == nil {
		sf = &storage.SettingsFile{FormatVersion: storage.CurrentFormatVersion}
	}
	// One-shot "updated to vX" notice: only when the version actually advanced;
	// a failed install relaunches the same version and must not show the notice.
	versionAdvanced := false
	if sf.LastRunVersion != "" && sf.LastRunVersion != info.Version {
		if cmp, err := updater.CompareVersion(info.Version, sf.LastRunVersion); err == nil && cmp > 0 {
			versionAdvanced = true
		}
	}
	dirty := false
	if !versionAdvanced && sf.UpdatedFromVersion != "" {
		sf.UpdatedFromVersion = ""
		dirty = true
	}
	if sf.LastRunVersion != info.Version {
		sf.LastRunVersion = info.Version
		dirty = true
	}
	if dirty {
		_ = a.storageMgr.SaveSettings(sf)
	}

	exePath, _ := os.Executable()
	settings := updater.Settings{
		AutoCheckEnabled:   !sf.AutoUpdateDisabled,
		MirrorURL:          sf.UpdateMirrorURL,
		SkippedVersion:     sf.SkippedUpdateVersion,
		UpdatedFromVersion: sf.UpdatedFromVersion,
	}
	a.updater = updater.NewManager(info, exePath, a.storageMgr.BaseDir(), settings,
		func(s updater.Settings) {
			cur, _, err := a.storageMgr.LoadSettings()
			if err != nil || cur == nil {
				return
			}
			cur.AutoUpdateDisabled = !s.AutoCheckEnabled
			cur.UpdateMirrorURL = s.MirrorURL
			cur.SkippedUpdateVersion = s.SkippedVersion
			cur.UpdatedFromVersion = s.UpdatedFromVersion
			_ = a.storageMgr.SaveSettings(cur)
		},
		func(state updater.UpdateState) {
			if a.ctx != nil && !a.isWidget {
				runtime.EventsEmit(a.ctx, "update:state", state)
			}
		})
	a.updater.Start()
}

// getUpdateBusyReasons lists human-readable reasons blocking an immediate restart.
func (a *App) getUpdateBusyReasons() []string {
	var reasons []string
	a.mu.Lock()
	switching := len(a.switchingIDs) > 0
	refreshingAll := a.refreshingAll || a.qianwenRefreshingAll || a.deepseekRefreshingAll
	a.mu.Unlock()
	if (a.service != nil && a.service.IsBusy()) ||
		(a.qianwenSvc != nil && a.qianwenSvc.IsBusy()) ||
		(a.deepseekSvc != nil && a.deepseekSvc.IsBusy()) ||
		switching || refreshingAll {
		reasons = append(reasons, "账号操作正在进行（切号 / 授权 / 配额刷新）")
	}
	if a.procMgr != nil {
		if n := a.procMgr.RunningCount(); n > 0 {
			reasons = append(reasons, fmt.Sprintf("「环境」中有 %d 个托管命令正在运行", n))
		}
	}
	return reasons
}

// onPotentialIdleForUpdate immediately restarts into an already-installed update once nothing is busy.
func (a *App) onPotentialIdleForUpdate() {
	if a.updater == nil || !a.updater.IsWaitingIdle() {
		return
	}
	reasons := a.getUpdateBusyReasons()
	if len(reasons) > 0 {
		a.updater.SetWaitingIdle(reasons)
		return
	}
	_ = a.executeRestartNow(true)
}

func (a *App) resolveUpdateExePath() (string, error) {
	if a.updater != nil && a.updater.ExePath() != "" {
		return a.updater.ExePath(), nil
	}
	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("获取当前程序路径失败: %w", err)
	}
	return exePath, nil
}

// executeRestartNow launches the detached restart helper and quits the current process.
func (a *App) executeRestartNow(fromWaitingOnly bool) error {
	if a.updater == nil || a.storageMgr == nil {
		return appservice.NewAppError("UPDATE_UNAVAILABLE", "更新功能不可用")
	}
	if a.updater.Mode() == updater.ModeDev {
		return appservice.NewAppError("UPDATE_DEV_MODE", "开发模式不支持自动安装更新，请使用正式构建版本")
	}
	started, err := a.updater.TryBeginRestart(fromWaitingOnly)
	if err != nil {
		return appservice.NewAppError("UPDATE_NOT_INSTALLED", err.Error())
	}
	if !started {
		return nil
	}
	exePath, err := a.resolveUpdateExePath()
	if err != nil {
		a.updater.RevertRestarting()
		return appservice.NewAppError("UPDATE_PATH_ERROR", err.Error())
	}

	cacheDir := filepath.Join(a.storageMgr.BaseDir(), "updates")
	launch := a.launchRestartFn
	if launch == nil {
		launch = updater.LaunchRestartHelper
	}
	if err := launch(updater.RestartParams{
		CurrentPID: os.Getpid(),
		ExePath:    exePath,
		ScriptPath: filepath.Join(cacheDir, "restart_app.ps1"),
		LogPath:    filepath.Join(cacheDir, "apply_update.log"),
	}); err != nil {
		a.updater.RevertRestarting()
		return appservice.NewAppError("UPDATE_LAUNCH_FAILED", err.Error())
	}
	if a.quitAppFn != nil {
		a.quitAppFn()
	} else {
		a.QuitApp()
	}
	return nil
}

// GetUpdateState returns the current update snapshot for initial frontend hydration.
func (a *App) GetUpdateState() updater.UpdateState {
	if a.updater == nil {
		info := a.GetAppInfo()
		return updater.UpdateState{
			Status:         updater.StatusIdle,
			CurrentVersion: info.Version,
			Channel:        info.Channel,
			InstallMode:    string(updater.DetectInstallMode(info.Channel, "")),
		}
	}
	return a.updater.State()
}

// CheckForUpdates runs a manual check, surfacing skipped versions and full errors.
func (a *App) CheckForUpdates() (updater.UpdateState, error) {
	if a.updater == nil {
		return a.GetUpdateState(), appservice.NewAppError("UPDATE_UNAVAILABLE", "更新功能不可用")
	}
	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.updater.Check(ctx, true)
}

// SaveUpdateSettings persists the auto-check switch and optional GitHub mirror prefix.
func (a *App) SaveUpdateSettings(autoCheck bool, mirrorURL string) (updater.UpdateState, error) {
	if a.updater == nil {
		return a.GetUpdateState(), appservice.NewAppError("UPDATE_UNAVAILABLE", "更新功能不可用")
	}
	if err := a.updater.ApplySettings(autoCheck, mirrorURL); err != nil {
		return a.updater.State(), appservice.NewAppError("UPDATE_INVALID_MIRROR", err.Error())
	}
	return a.updater.State(), nil
}

// SkipUpdateVersion records a skipped version and dismisses its pending offer.
func (a *App) SkipUpdateVersion(version string) (updater.UpdateState, error) {
	if a.updater == nil {
		return a.GetUpdateState(), appservice.NewAppError("UPDATE_UNAVAILABLE", "更新功能不可用")
	}
	a.updater.SkipVersion(version)
	return a.updater.State(), nil
}

// InstallUpdate installs the downloaded & verified update in place while the app stays open.
// Upon success the state transitions to "installed" so the UI prompts the user to restart.
func (a *App) InstallUpdate() (updater.UpdateState, error) {
	if a.updater == nil || a.storageMgr == nil {
		return a.GetUpdateState(), appservice.NewAppError("UPDATE_UNAVAILABLE", "更新功能不可用")
	}
	if a.updater.Mode() == updater.ModeDev {
		return a.updater.State(), appservice.NewAppError("UPDATE_DEV_MODE", "开发模式不支持自动安装更新，请使用正式构建版本")
	}
	filePath, started, err := a.updater.TryBeginInstall()
	if err != nil {
		return a.updater.State(), appservice.NewAppError("UPDATE_NOT_READY", err.Error())
	}
	if !started {
		return a.updater.State(), nil
	}
	exePath, err := a.resolveUpdateExePath()
	if err != nil {
		a.updater.RevertInstallingToReady()
		return a.updater.State(), appservice.NewAppError("UPDATE_PATH_ERROR", err.Error())
	}

	cacheDir := filepath.Join(a.storageMgr.BaseDir(), "updates")
	install := a.installUpdateFn
	if install == nil {
		install = updater.InstallInPlace
	}
	if err := install(updater.InstallParams{
		Mode:           a.updater.Mode(),
		ExePath:        exePath,
		InstallDir:     filepath.Dir(exePath),
		DownloadedFile: filePath,
		ScriptPath:     filepath.Join(cacheDir, "install_update.ps1"),
		LogPath:        filepath.Join(cacheDir, "apply_update.log"),
	}); err != nil {
		a.updater.RevertInstallingToReady()
		if errors.Is(err, updater.ErrInstallCancelled) {
			return a.updater.State(), appservice.NewAppError("UPDATE_INSTALL_CANCELLED", err.Error())
		}
		return a.updater.State(), appservice.NewAppError("UPDATE_INSTALL_FAILED", err.Error())
	}

	// Record pre-update version as soon as installation succeeds so even a manual restart later
	// shows the one-shot "updated to vX" notice on next launch.
	if sf, _, err := a.storageMgr.LoadSettings(); err == nil && sf != nil {
		sf.UpdatedFromVersion = a.GetAppInfo().Version
		_ = a.storageMgr.SaveSettings(sf)
	}

	a.updater.MarkInstalled()
	return a.updater.State(), nil
}

// RestartToApplyUpdate restarts the app to run the already-installed update, or defers until idle.
func (a *App) RestartToApplyUpdate() (updater.UpdateState, error) {
	if a.updater == nil || a.storageMgr == nil {
		return a.GetUpdateState(), appservice.NewAppError("UPDATE_UNAVAILABLE", "更新功能不可用")
	}
	if a.updater.Mode() == updater.ModeDev {
		return a.updater.State(), appservice.NewAppError("UPDATE_DEV_MODE", "开发模式不支持自动安装更新，请使用正式构建版本")
	}
	if !a.updater.IsInstalled() {
		return a.updater.State(), appservice.NewAppError("UPDATE_NOT_INSTALLED", "当前没有已安装待重启的更新")
	}
	if reasons := a.getUpdateBusyReasons(); len(reasons) > 0 {
		a.updater.SetWaitingIdle(reasons)
		return a.updater.State(), nil
	}
	if err := a.executeRestartNow(false); err != nil {
		return a.updater.State(), err
	}
	return a.updater.State(), nil
}

// CancelDeferredUpdate cancels a waiting-idle restart reservation, returning to installed state.
func (a *App) CancelDeferredUpdate() updater.UpdateState {
	if a.updater != nil {
		a.updater.CancelWaiting()
		return a.updater.State()
	}
	return a.GetUpdateState()
}

// DismissUpdatedNotice clears the one-shot post-update notice.
func (a *App) DismissUpdatedNotice() error {
	if a.updater != nil {
		a.updater.DismissUpdatedNotice()
	}
	return nil
}

// OpenReleasePage opens a GitHub release page, restricted to this project's repository.
func (a *App) OpenReleasePage(rawURL string) error {
	if !updater.ReleasePageAllowed(rawURL) {
		return appservice.NewAppError("UPDATE_URL_FORBIDDEN", "仅允许打开 Graviton 官方 GitHub 页面")
	}
	if a.ctx != nil {
		runtime.BrowserOpenURL(a.ctx, rawURL)
	}
	return nil
}
