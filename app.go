package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"codetool/internal/appservice"
	"codetool/internal/client"
	"codetool/internal/storage"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx        context.Context
	service    *appservice.AppService
	storageMgr *storage.StorageManager
}

// NewApp creates a new App application struct
func NewApp() *App {
	sm, err := storage.NewStorageManager("")
	if err != nil {
		fmt.Printf("Warning: failed to initialize storage manager: %v\n", err)
	}
	svc := appservice.NewAppService(sm, nil)
	return &App{
		service:    svc,
		storageMgr: sm,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// onSecondInstanceLaunch is invoked when a user launches a second instance.
func (a *App) onSecondInstanceLaunch(secondInstanceData optionsSecondInstanceData) {
	if a.ctx != nil {
		runtime.WindowUnminimise(a.ctx)
		runtime.Show(a.ctx)
		runtime.WindowSetAlwaysOnTop(a.ctx, true)
		runtime.WindowSetAlwaysOnTop(a.ctx, false)
	}
}

type optionsSecondInstanceData struct {
	Args             []string
	WorkingDirectory string
}

// ListAccounts returns all recorded accounts with their quota snapshots and current status.
func (a *App) ListAccounts() ([]appservice.AccountDisplay, error) {
	return a.service.ListAccounts()
}

// CaptureCurrentAccount captures the client's currently logged-in account.
func (a *App) CaptureCurrentAccount() (*appservice.AccountDisplay, error) {
	return a.service.CaptureCurrentAccount()
}

// RefreshAccountQuota updates the quota for a specific account.
func (a *App) RefreshAccountQuota(id string) (*appservice.AccountDisplay, error) {
	return a.service.RefreshAccountQuota(id)
}

// RefreshAllQuotas updates quotas for all accounts with up to 5 concurrent workers.
func (a *App) RefreshAllQuotas() ([]appservice.BatchRefreshResult, error) {
	return a.service.RefreshAllQuotas()
}

// SwitchAccount switches Antigravity active account.
func (a *App) SwitchAccount(id string) (*client.SwitchResult, error) {
	return a.service.SwitchAccount(id)
}

// DeleteAccount removes an account from CodeTool storage and deletes its independent credential.
func (a *App) DeleteAccount(id string) error {
	return a.service.DeleteAccount(id)
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
