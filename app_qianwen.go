package main

import (
	"errors"

	"graviton/internal/appservice"
	"graviton/internal/qianwen"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ListQianwenAccounts returns all stored Qianwen accounts and their latest Token Plan snapshots.
func (a *App) ListQianwenAccounts() ([]qianwen.AccountDisplay, error) {
	if a.qianwenSvc == nil {
		return []qianwen.AccountDisplay{}, nil
	}
	return a.qianwenSvc.ListAccounts()
}

// StartQianwenAuth initiates Qianwen Device Authorization + PKCE flow, opens the browser, and emits "qianwen:auth".
func (a *App) StartQianwenAuth(reauthAccountID string) (*qianwen.AuthStartResponse, error) {
	if a.qianwenSvc == nil {
		return nil, errors.New("[NOT_INITIALIZED] 千问服务未初始化")
	}
	res, err := a.qianwenSvc.StartAuth(reauthAccountID, func(evt qianwen.AuthEvent) {
		if a.ctx != nil && !a.isWidget {
			runtime.EventsEmit(a.ctx, "qianwen:auth", evt)
			if evt.Status == "complete" {
				runtime.EventsEmit(a.ctx, "qianwen:updated", true)
			}
		}
		a.onPotentialIdleForUpdate()
	})
	if err != nil {
		return nil, err
	}
	if a.ctx != nil && !a.isWidget && res.VerificationURL != "" {
		runtime.BrowserOpenURL(a.ctx, res.VerificationURL)
	}
	return res, nil
}

// CancelQianwenAuth cancels an active Qianwen device authorization polling session.
func (a *App) CancelQianwenAuth() {
	if a.qianwenSvc != nil {
		a.qianwenSvc.CancelAuth()
	}
	a.onPotentialIdleForUpdate()
}

// RefreshQianwenAccount refreshes Token Plan usage for a single Qianwen account.
func (a *App) RefreshQianwenAccount(id string) (*qianwen.AccountDisplay, error) {
	if a.qianwenSvc == nil {
		return nil, errors.New("[NOT_INITIALIZED] 千问服务未初始化")
	}

	a.mu.Lock()
	if a.qianwenRefreshingIDs == nil {
		a.qianwenRefreshingIDs = make(map[string]bool)
	}
	a.qianwenRefreshingIDs[id] = true
	a.mu.Unlock()

	res, err := a.qianwenSvc.RefreshAccount(id)

	a.mu.Lock()
	delete(a.qianwenRefreshingIDs, id)
	a.mu.Unlock()

	if a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "qianwen:updated", true)
	}
	a.onPotentialIdleForUpdate()
	return res, err
}

// RefreshAllQianwenAccounts refreshes Token Plan usage for all stored Qianwen accounts concurrently.
func (a *App) RefreshAllQianwenAccounts() ([]qianwen.BatchRefreshResult, error) {
	if a.qianwenSvc == nil {
		return []qianwen.BatchRefreshResult{}, nil
	}

	a.mu.Lock()
	if a.qianwenRefreshingAll {
		a.mu.Unlock()
		return nil, appservice.NewAppError("BUSY", "正在刷新全部千问账号，请稍候")
	}
	a.qianwenRefreshingAll = true
	a.mu.Unlock()

	res, err := a.qianwenSvc.RefreshAllAccounts(func(item qianwen.BatchRefreshResult) {
		if a.ctx != nil && !a.isWidget {
			runtime.EventsEmit(a.ctx, "qianwen:quota_progress", item)
		}
	})

	a.mu.Lock()
	a.qianwenRefreshingAll = false
	a.mu.Unlock()

	if a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "qianwen:updated", true)
	}
	a.onPotentialIdleForUpdate()
	return res, err
}

// DeleteQianwenAccount deletes a Qianwen account record and its stored credential.
func (a *App) DeleteQianwenAccount(id string) error {
	if a.qianwenSvc == nil {
		return errors.New("[NOT_INITIALIZED] 千问服务未初始化")
	}
	err := a.qianwenSvc.DeleteAccount(id)
	if err == nil && a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "qianwen:updated", true)
	}
	a.onPotentialIdleForUpdate()
	return err
}
