package main

import (
	"testing"
	"time"

	"codetool/internal/appservice"
	"codetool/internal/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestApp(t *testing.T) *App {
	t.Helper()
	sm, err := storage.NewStorageManager(t.TempDir())
	require.NoError(t, err)
	return &App{
		service:       appservice.NewAppService(sm, nil),
		storageMgr:    sm,
		refreshingIDs: make(map[string]bool),
		switchingIDs:  make(map[string]bool),
		stopAuto:      make(chan struct{}),
	}
}

func TestAutoRefreshLoop_RefreshesAllAccountsOnTick(t *testing.T) {
	assert.Equal(t, 5*time.Minute, autoRefreshInterval)

	app := newTestApp(t)
	app.startAutoRefreshLoopWithInterval(10 * time.Millisecond)
	defer close(app.stopAuto)

	require.Eventually(t, func() bool {
		app.mu.Lock()
		defer app.mu.Unlock()
		return app.lastUpdated != ""
	}, time.Second, 5*time.Millisecond)
}

func TestRefreshAllQuotas_RejectsConcurrentRefresh(t *testing.T) {
	app := newTestApp(t)
	app.mu.Lock()
	app.refreshingAll = true
	app.mu.Unlock()

	_, err := app.RefreshAllQuotas()
	require.Error(t, err)
	var appErr *appservice.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, "BUSY", appErr.Code)

	app.mu.Lock()
	assert.True(t, app.refreshingAll)
	app.mu.Unlock()
}
