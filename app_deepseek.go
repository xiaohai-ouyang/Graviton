package main

import (
	"errors"

	"graviton/internal/appservice"
	"graviton/internal/deepseek"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ListDeepSeekAccounts returns all stored DeepSeek accounts and their latest balance snapshots.
func (a *App) ListDeepSeekAccounts() ([]deepseek.AccountDisplay, error) {
	if a.deepseekSvc == nil {
		return []deepseek.AccountDisplay{}, nil
	}
	return a.deepseekSvc.ListAccounts()
}

// AddDeepSeekAccount validates a DeepSeek API key, stores it in Windows Credential Manager,
// and persists the sanitized account record and initial balance snapshot.
func (a *App) AddDeepSeekAccount(name string, apiKey string) (*deepseek.AccountDisplay, error) {
	if a.deepseekSvc == nil {
		return nil, errors.New("[NOT_INITIALIZED] DeepSeek 服务未初始化")
	}
	res, err := a.deepseekSvc.AddAccount(name, apiKey)
	if err == nil && a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "deepseek:updated", true)
	}
	a.onPotentialIdleForUpdate()
	return res, err
}

// UpdateDeepSeekAccount renames a DeepSeek account and/or replaces its API key.
func (a *App) UpdateDeepSeekAccount(id string, name string, apiKey string) (*deepseek.AccountDisplay, error) {
	if a.deepseekSvc == nil {
		return nil, errors.New("[NOT_INITIALIZED] DeepSeek 服务未初始化")
	}
	res, err := a.deepseekSvc.UpdateAccount(id, name, apiKey)
	if err == nil && a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "deepseek:updated", true)
	}
	a.onPotentialIdleForUpdate()
	return res, err
}

// RefreshDeepSeekAccount refreshes the balance for a single DeepSeek account.
func (a *App) RefreshDeepSeekAccount(id string) (*deepseek.AccountDisplay, error) {
	if a.deepseekSvc == nil {
		return nil, errors.New("[NOT_INITIALIZED] DeepSeek 服务未初始化")
	}

	a.mu.Lock()
	if a.deepseekRefreshingIDs == nil {
		a.deepseekRefreshingIDs = make(map[string]bool)
	}
	a.deepseekRefreshingIDs[id] = true
	a.mu.Unlock()

	res, err := a.deepseekSvc.RefreshAccount(id)

	a.mu.Lock()
	delete(a.deepseekRefreshingIDs, id)
	a.mu.Unlock()

	if a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "deepseek:updated", true)
	}
	a.onPotentialIdleForUpdate()
	return res, err
}

// RefreshAllDeepSeekAccounts refreshes balances for all stored DeepSeek accounts concurrently.
func (a *App) RefreshAllDeepSeekAccounts() ([]deepseek.BatchRefreshResult, error) {
	if a.deepseekSvc == nil {
		return []deepseek.BatchRefreshResult{}, nil
	}

	a.mu.Lock()
	if a.deepseekRefreshingAll {
		a.mu.Unlock()
		return nil, appservice.NewAppError("BUSY", "正在刷新全部 DeepSeek 账号，请稍候")
	}
	a.deepseekRefreshingAll = true
	a.mu.Unlock()

	res, err := a.deepseekSvc.RefreshAllAccounts(func(item deepseek.BatchRefreshResult) {
		if a.ctx != nil && !a.isWidget {
			runtime.EventsEmit(a.ctx, "deepseek:quota_progress", item)
		}
	})

	a.mu.Lock()
	a.deepseekRefreshingAll = false
	a.mu.Unlock()

	if a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "deepseek:updated", true)
	}
	a.onPotentialIdleForUpdate()
	return res, err
}

// DeleteDeepSeekAccount deletes a DeepSeek account record and its stored credential.
func (a *App) DeleteDeepSeekAccount(id string) error {
	if a.deepseekSvc == nil {
		return errors.New("[NOT_INITIALIZED] DeepSeek 服务未初始化")
	}
	err := a.deepseekSvc.DeleteAccount(id)
	if err == nil && a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "deepseek:updated", true)
	}
	a.onPotentialIdleForUpdate()
	return err
}
