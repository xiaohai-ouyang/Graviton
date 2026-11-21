package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"graviton/internal/appservice"
	"graviton/internal/client"
	"graviton/internal/envmgr"
	"graviton/internal/storage"
	"graviton/internal/tray"
	"graviton/internal/widget"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// WidgetConnection holds connection & initial position info for the widget frontend.
type WidgetConnection struct {
	Port   int  `json:"port"`
	Token  string `json:"token"`
	X      int  `json:"x"`
	Y      int  `json:"y"`
	HasPos bool `json:"hasPos"`
}

// App struct
type App struct {
	ctx        context.Context
	service    *appservice.AppService
	storageMgr *storage.StorageManager

	isWidget    bool
	widgetPort  int
	widgetToken string
	widgetMgr   *widget.Manager
	trayIcon    *tray.Tray
	procMgr     *envmgr.ProcessManager
	projectsMu  sync.Mutex

	mu                sync.Mutex
	theme             string
	resetTimeFormat   string
	widgetLocked      bool
	widgetAlwaysOnTop bool
	refreshingAll     bool
	refreshingIDs map[string]bool
	switchingIDs  map[string]bool
	lastUpdated   string
	stopAuto      chan struct{}
	quitting      bool
}

// NewApp creates a new App application struct for the main window.
func NewApp() *App {
	sm, err := storage.NewStorageManager("")
	if err != nil {
		fmt.Printf("Warning: failed to initialize storage manager: %v\n", err)
	}
	svc := appservice.NewAppService(sm, nil)
	theme := "light"
	resetTimeFormat := "countdown"
	widgetLocked := false
	widgetAlwaysOnTop := false
	if sm != nil {
		if sf, _, err := sm.LoadSettings(); err == nil {
			if sf.Theme != "" {
				theme = sf.Theme
			}
			if sf.ResetTimeFormat == "countdown" || sf.ResetTimeFormat == "absolute" {
				resetTimeFormat = sf.ResetTimeFormat
			}
			widgetLocked = sf.WidgetLocked
			widgetAlwaysOnTop = sf.WidgetAlwaysOnTop
		}
	}
	return &App{
		service:           svc,
		storageMgr:        sm,
		theme:             theme,
		resetTimeFormat:   resetTimeFormat,
		widgetLocked:      widgetLocked,
		widgetAlwaysOnTop: widgetAlwaysOnTop,
		refreshingIDs:     make(map[string]bool),
		switchingIDs:      make(map[string]bool),
		stopAuto:          make(chan struct{}),
	}
}

// NewWidgetApp creates an App instance for the floating widget process.
func NewWidgetApp(port int, token string) *App {
	sm, _ := storage.NewStorageManager("")
	return &App{
		storageMgr:    sm,
		isWidget:      true,
		widgetPort:    port,
		widgetToken:   token,
		refreshingIDs: make(map[string]bool),
		switchingIDs:  make(map[string]bool),
	}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.isWidget {
		return
	}

	a.procMgr = envmgr.NewProcessManager(envmgr.RunnerCallbacks{
		OnStatus: func(state envmgr.ProcessState) {
			if a.ctx != nil && !a.isWidget {
				runtime.EventsEmit(a.ctx, "env:process:status", state)
			}
		},
		OnLog: func(entry envmgr.LogEntry) {
			if a.ctx != nil && !a.isWidget {
				runtime.EventsEmit(a.ctx, "env:process:log", entry)
			}
		},
	})

	a.widgetMgr = widget.NewManager(widget.Handlers{
		GetState: a.buildStateSnapshot,
		Refresh:  a.handleWidgetRefresh,
		Switch:   a.handleWidgetSwitch,
		OpenMain: a.ShowMainWindow,
		CloseWidget: func() {
			a.setWidgetEnabledSetting(false)
			a.widgetMgr.StopWidget()
			a.emitWidgetStatus(false)
		},
		SavePosition: a.saveWidgetPosition,
		SetLocked:    a.setWidgetLocked,
		OnWidgetExit: func() {
			a.emitWidgetStatus(false)
		},
	})

	if err := a.widgetMgr.StartServer(); err != nil {
		fmt.Printf("Warning: failed to start widget IPC server: %v\n", err)
	}

	a.trayIcon = tray.Start(tray.Callbacks{
		Tooltip:    a.GetAppInfo().TrayTooltip("Graviton"),
		OnShowMain: a.ShowMainWindow,
		OnToggleWidget: func() {
			_, _ = a.ToggleWidget()
		},
		OnRefreshAll: func() {
			_, _ = a.RefreshAllQuotas()
		},
		OnQuit: a.QuitApp,
	})

	a.startAutoRefreshLoop()

	if a.storageMgr != nil {
		if sf, _, err := a.storageMgr.LoadSettings(); err == nil && sf.WidgetEnabled {
			if err := a.widgetMgr.StartWidget(); err == nil {
				a.emitWidgetStatus(true)
			}
		}
	}
}

// domReady is called when the WebView DOM has finished loading.
func (a *App) domReady(ctx context.Context) {
	if !a.isWidget {
		return
	}
	widget.ConfigureWidgetWindow(widget.WidgetWindowTitle)
	if a.storageMgr != nil {
		if sf, _, err := a.storageMgr.LoadSettings(); err == nil {
			if sf.WidgetAlwaysOnTop {
				runtime.WindowSetAlwaysOnTop(a.ctx, true)
			}
			if sf.WidgetHasPos {
				wa := widget.GetWorkArea(widget.WidgetWindowTitle)
				x, y := sf.WidgetX, sf.WidgetY
				if x >= wa.Left-20 && x <= wa.Right-40 && y >= wa.Top-20 && y <= wa.Bottom-40 {
					widget.SetWindowBounds(widget.WidgetWindowTitle, x, y)
				}
			}
		}
	}
}

// onBeforeClose intercepts window close so the main window hides to the system tray.
func (a *App) onBeforeClose(ctx context.Context) bool {
	if a.isWidget {
		return false
	}
	a.mu.Lock()
	quitting := a.quitting
	a.mu.Unlock()
	if quitting {
		return false
	}
	runtime.Hide(ctx)
	return true
}

// shutdown cleans up background resources when the app exits.
func (a *App) shutdown(ctx context.Context) {
	if a.isWidget {
		return
	}
	select {
	case <-a.stopAuto:
	default:
		close(a.stopAuto)
	}
	if a.trayIcon != nil {
		a.trayIcon.Close()
	}
	if a.widgetMgr != nil {
		a.widgetMgr.Stop()
	}
	if a.procMgr != nil {
		a.procMgr.StopAll()
	}
}

// onSecondInstanceLaunch is invoked when a user launches a second instance.
func (a *App) onSecondInstanceLaunch(secondInstanceData optionsSecondInstanceData) {
	a.ShowMainWindow()
}

type optionsSecondInstanceData struct {
	Args             []string
	WorkingDirectory string
}

// ShowMainWindow restores and focuses the main application window.
func (a *App) ShowMainWindow() {
	if a.ctx == nil || a.isWidget {
		return
	}
	runtime.WindowUnminimise(a.ctx)
	runtime.Show(a.ctx)
	runtime.WindowSetAlwaysOnTop(a.ctx, true)
	runtime.WindowSetAlwaysOnTop(a.ctx, false)
}

// QuitApp exits the entire application including the tray and floating widget.
func (a *App) QuitApp() {
	a.mu.Lock()
	a.quitting = true
	a.mu.Unlock()
	if a.trayIcon != nil {
		a.trayIcon.Close()
	}
	if a.widgetMgr != nil {
		a.widgetMgr.Stop()
	}
	if a.procMgr != nil {
		a.procMgr.StopAll()
	}
	if a.ctx != nil {
		runtime.Quit(a.ctx)
	}
}

// IsWidgetMode reports whether this process is running as the floating widget.
func (a *App) IsWidgetMode() bool {
	return a.isWidget
}

// GetWidgetConnection returns IPC connection details and saved coordinates for the widget.
func (a *App) GetWidgetConnection() WidgetConnection {
	conn := WidgetConnection{
		Port:  a.widgetPort,
		Token: a.widgetToken,
	}
	if a.storageMgr != nil {
		if sf, _, err := a.storageMgr.LoadSettings(); err == nil && sf.WidgetHasPos {
			conn.X = sf.WidgetX
			conn.Y = sf.WidgetY
			conn.HasPos = true
		}
	}
	return conn
}

// SetWidgetSize resizes the floating widget window.
func (a *App) SetWidgetSize(width, height int) {
	if a.ctx != nil && a.isWidget {
		runtime.WindowSetSize(a.ctx, width, height)
	}
}

// GetWidgetWindowBounds returns the current screen coordinates and size of the widget window.
func (a *App) GetWidgetWindowBounds() widget.WindowBounds {
	b, _ := widget.GetWindowBounds(widget.WidgetWindowTitle)
	return b
}

// SetWidgetPosition moves the widget window to (x, y).
func (a *App) SetWidgetPosition(x, y int) {
	if a.isWidget {
		widget.SetWindowBounds(widget.WidgetWindowTitle, x, y)
	}
}

// GetScreenWorkArea returns the usable screen bounds of the monitor containing the widget.
func (a *App) GetScreenWorkArea() widget.WorkArea {
	return widget.GetWorkArea(widget.WidgetWindowTitle)
}

// ToggleWidget toggles the floating widget window on or off.
func (a *App) ToggleWidget() (bool, error) {
	if a.widgetMgr == nil {
		return false, errors.New("widget manager not initialized")
	}
	if a.widgetMgr.IsWidgetRunning() {
		a.setWidgetEnabledSetting(false)
		a.widgetMgr.StopWidget()
		a.emitWidgetStatus(false)
		return false, nil
	}
	a.setWidgetEnabledSetting(true)
	if err := a.widgetMgr.StartWidget(); err != nil {
		a.setWidgetEnabledSetting(false)
		return false, err
	}
	a.emitWidgetStatus(true)
	return true, nil
}

// GetWidgetAlwaysOnTop reports whether the floating widget is configured to stay always on top.
func (a *App) GetWidgetAlwaysOnTop() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.widgetAlwaysOnTop
}

// SetWidgetAlwaysOnTop updates whether the floating widget stays on top, persists it, and syncs to the widget.
func (a *App) SetWidgetAlwaysOnTop(alwaysOnTop bool) {
	a.mu.Lock()
	a.widgetAlwaysOnTop = alwaysOnTop
	a.mu.Unlock()

	if a.storageMgr != nil {
		if sf, _, err := a.storageMgr.LoadSettings(); err == nil {
			sf.WidgetAlwaysOnTop = alwaysOnTop
			_ = a.storageMgr.SaveSettings(sf)
		}
	}
	if a.widgetMgr != nil {
		a.widgetMgr.BroadcastState()
	}
}

// ApplyWidgetAlwaysOnTop applies the always-on-top window flag on the floating widget process.
func (a *App) ApplyWidgetAlwaysOnTop(alwaysOnTop bool) {
	if a.ctx != nil && a.isWidget {
		runtime.WindowSetAlwaysOnTop(a.ctx, alwaysOnTop)
	}
}

// IsWidgetOpen reports whether the floating widget is currently running.
func (a *App) IsWidgetOpen() bool {
	if a.widgetMgr == nil {
		return false
	}
	return a.widgetMgr.IsWidgetRunning()
}

// SyncTheme updates the resolved theme ("light" or "dark") and syncs it to the widget.
func (a *App) SyncTheme(theme string) {
	if theme != "dark" && theme != "light" {
		return
	}
	a.mu.Lock()
	a.theme = theme
	a.mu.Unlock()

	if a.storageMgr != nil {
		if sf, _, err := a.storageMgr.LoadSettings(); err == nil {
			sf.Theme = theme
			_ = a.storageMgr.SaveSettings(sf)
		}
	}
	if a.widgetMgr != nil {
		a.widgetMgr.BroadcastState()
	}
}

// SyncResetTimeFormat updates the reset time display format ("countdown" or "absolute") and syncs it to the widget.
func (a *App) SyncResetTimeFormat(format string) {
	if format != "countdown" && format != "absolute" {
		return
	}
	a.mu.Lock()
	a.resetTimeFormat = format
	a.mu.Unlock()

	if a.storageMgr != nil {
		if sf, _, err := a.storageMgr.LoadSettings(); err == nil {
			sf.ResetTimeFormat = format
			_ = a.storageMgr.SaveSettings(sf)
		}
	}
	if a.widgetMgr != nil {
		a.widgetMgr.BroadcastState()
	}
}

func (a *App) setWidgetEnabledSetting(enabled bool) {
	if a.storageMgr == nil {
		return
	}
	if sf, _, err := a.storageMgr.LoadSettings(); err == nil {
		sf.WidgetEnabled = enabled
		_ = a.storageMgr.SaveSettings(sf)
	}
}

func (a *App) saveWidgetPosition(x, y int) {
	if a.storageMgr == nil {
		return
	}
	if sf, _, err := a.storageMgr.LoadSettings(); err == nil {
		sf.WidgetX = x
		sf.WidgetY = y
		sf.WidgetHasPos = true
		_ = a.storageMgr.SaveSettings(sf)
	}
}

func (a *App) setWidgetLocked(locked bool) {
	a.mu.Lock()
	a.widgetLocked = locked
	a.mu.Unlock()

	if a.storageMgr != nil {
		if sf, _, err := a.storageMgr.LoadSettings(); err == nil {
			sf.WidgetLocked = locked
			_ = a.storageMgr.SaveSettings(sf)
		}
	}
	a.notifyStateChanged()
}

func (a *App) emitWidgetStatus(open bool) {
	if a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "widget:status", open)
	}
}

func (a *App) buildStateSnapshot() widget.StateSnapshot {
	accounts, _ := a.service.ListAccounts()
	a.mu.Lock()
	defer a.mu.Unlock()

	refIDs := make(map[string]bool, len(a.refreshingIDs))
	for k, v := range a.refreshingIDs {
		refIDs[k] = v
	}
	swIDs := make(map[string]bool, len(a.switchingIDs))
	for k, v := range a.switchingIDs {
		swIDs[k] = v
	}

	resetFormat := a.resetTimeFormat
	if resetFormat == "" {
		resetFormat = "countdown"
	}

	return widget.StateSnapshot{
		Accounts:          accounts,
		Theme:             a.theme,
		RefreshingAll:     a.refreshingAll,
		RefreshingIDs:     refIDs,
		SwitchingIDs:      swIDs,
		LastUpdated:       a.lastUpdated,
		WidgetLocked:      a.widgetLocked,
		WidgetAlwaysOnTop: a.widgetAlwaysOnTop,
		ResetTimeFormat:   resetFormat,
	}
}

func (a *App) notifyStateChanged() {
	a.mu.Lock()
	a.lastUpdated = time.Now().Format(time.RFC3339)
	a.mu.Unlock()

	if a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "accounts:updated", true)
	}
	if a.widgetMgr != nil {
		a.widgetMgr.BroadcastState()
	}
}

func (a *App) handleWidgetRefresh(id string) error {
	if id == "all" {
		_, err := a.RefreshAllQuotas()
		return err
	}
	if id == "" {
		accounts, err := a.service.ListAccounts()
		if err != nil {
			return err
		}
		for _, acc := range accounts {
			if acc.IsCurrent {
				id = acc.ID
				break
			}
		}
		if id == "" {
			return errors.New("未识别到当前账号")
		}
	}
	_, err := a.RefreshAccountQuota(id)
	return err
}

func (a *App) handleWidgetSwitch(id string) error {
	_, err := a.SwitchAccount(id)
	return err
}

const autoRefreshInterval = 5 * time.Minute

func (a *App) startAutoRefreshLoop() {
	a.startAutoRefreshLoopWithInterval(autoRefreshInterval)
}

func (a *App) startAutoRefreshLoopWithInterval(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-a.stopAuto:
				return
			case <-ticker.C:
				_, _ = a.RefreshAllQuotas()
			}
		}
	}()
}

// ListAccounts returns all recorded accounts with their quota snapshots and current status.
func (a *App) ListAccounts() ([]appservice.AccountDisplay, error) {
	return a.service.ListAccounts()
}

// CaptureCurrentAccount captures the client's currently logged-in account.
func (a *App) CaptureCurrentAccount() (*appservice.AccountDisplay, error) {
	res, err := a.service.CaptureCurrentAccount()
	if err == nil {
		a.notifyStateChanged()
	}
	return res, err
}

// StartOAuthLogin starts a local OAuth callback listener, opens the system browser, and emits "oauth:completed".
func (a *App) StartOAuthLogin() (*appservice.OAuthStartResult, error) {
	res, err := a.service.StartOAuthLogin(func(evt appservice.OAuthCompletionEvent) {
		if a.ctx != nil {
			runtime.EventsEmit(a.ctx, "oauth:completed", evt)
		}
		if evt.Account != nil {
			a.notifyStateChanged()
		}
	})
	if err != nil {
		return nil, err
	}
	if a.ctx != nil {
		runtime.BrowserOpenURL(a.ctx, res.AuthURL)
	}
	return res, nil
}

// CancelOAuthLogin cancels an active OAuth login session.
func (a *App) CancelOAuthLogin() {
	a.service.CancelOAuthLogin()
}

// CompleteOAuthWithCallbackURL manually completes an active OAuth login using a pasted callback URL.
func (a *App) CompleteOAuthWithCallbackURL(rawURL string) (*appservice.AccountDisplay, error) {
	res, err := a.service.CompleteOAuthWithCallbackURL(rawURL)
	if err == nil {
		a.notifyStateChanged()
	}
	return res, err
}

// ImportRefreshTokens imports one or more Google OAuth refresh tokens (text or JSON).
func (a *App) ImportRefreshTokens(rawInput string) (*appservice.BatchImportResult, error) {
	res, err := a.service.ImportRefreshTokens(rawInput)
	if err == nil {
		a.notifyStateChanged()
	}
	return res, err
}

// RefreshAccountQuota updates the quota for a specific account.
func (a *App) RefreshAccountQuota(id string) (*appservice.AccountDisplay, error) {
	a.mu.Lock()
	a.refreshingIDs[id] = true
	a.mu.Unlock()
	if a.widgetMgr != nil {
		a.widgetMgr.BroadcastState()
	}

	res, err := a.service.RefreshAccountQuota(id)

	a.mu.Lock()
	delete(a.refreshingIDs, id)
	a.mu.Unlock()
	a.notifyStateChanged()
	return res, err
}

// RefreshAllQuotas updates quotas for all accounts concurrently and emits progress events.
func (a *App) RefreshAllQuotas() ([]appservice.BatchRefreshResult, error) {
	a.mu.Lock()
	if a.refreshingAll {
		a.mu.Unlock()
		return nil, appservice.NewAppError("BUSY", "正在刷新全部账号，请稍候")
	}
	a.refreshingAll = true
	a.mu.Unlock()
	if a.widgetMgr != nil {
		a.widgetMgr.BroadcastState()
	}

	res, err := a.service.RefreshAllQuotasWithProgress(func(item appservice.BatchRefreshResult) {
		if a.ctx != nil && !a.isWidget {
			runtime.EventsEmit(a.ctx, "accounts:quota_progress", item)
		}
	})

	a.mu.Lock()
	a.refreshingAll = false
	a.mu.Unlock()
	a.notifyStateChanged()
	return res, err
}

// SwitchAccount switches Antigravity active account.
func (a *App) SwitchAccount(id string) (*client.SwitchResult, error) {
	a.mu.Lock()
	a.switchingIDs[id] = true
	a.mu.Unlock()
	if a.widgetMgr != nil {
		a.widgetMgr.BroadcastState()
	}

	res, err := a.service.SwitchAccount(id)

	a.mu.Lock()
	delete(a.switchingIDs, id)
	a.mu.Unlock()
	a.notifyStateChanged()
	return res, err
}

// DeleteAccount removes an account from CodeTool storage and deletes its independent credential.
func (a *App) DeleteAccount(id string) error {
	err := a.service.DeleteAccount(id)
	if err == nil {
		a.notifyStateChanged()
	}
	return err
}

// SelectClientPath opens a native file dialog to choose Antigravity executable, validates and saves it.
func (a *App) SelectClientPath() (string, error) {
	selected, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择 Antigravity 客户端可执行文件",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "可执行文件 (*.exe)",
				Pattern:     "*.exe",
			},
		},
	})
	if err != nil {
		return "", fmt.Errorf("打开文件选择器失败: %w", err)
	}
	if selected == "" {
		return a.service.GetClientPath(), nil
	}

	if _, err := os.Stat(selected); err != nil {
		return "", errors.New("所选文件不存在")
	}

	if err := a.service.SaveClientPath(selected); err != nil {
		return "", fmt.Errorf("保存客户端路径设置失败: %w", err)
	}

	return selected, nil
}

// GetClientPath returns the currently configured Antigravity executable path.
func (a *App) GetClientPath() string {
	return a.service.GetClientPath()
}
