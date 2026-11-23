package storage

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDeepSeekAccounts_SaveAndLoad(t *testing.T) {
	sm, err := NewStorageManager(t.TempDir())
	require.NoError(t, err)

	// Missing file returns empty slice without error
	records, report, err := sm.LoadDeepSeekAccounts()
	require.NoError(t, err)
	assert.Empty(t, report)
	assert.Empty(t, records)

	input := []DeepSeekAccountRecord{
		{
			ID:             "ds-1",
			Name:           "个人主号",
			KeyPreview:     "sk-1234...abcd",
			KeyFingerprint: "deadbeef",
			CreatedAt:      "2026-11-23T08:00:00Z",
			Balance: DeepSeekBalanceSnapshot{
				IsAvailable: true,
				BalanceInfos: []DeepSeekBalanceInfo{
					{
						Currency:        "CNY",
						TotalBalance:    "110.00",
						GrantedBalance:  "10.00",
						ToppedUpBalance: "100.00",
					},
				},
				LastRefreshedAt: "2026-11-23T08:05:00Z",
			},
		},
	}

	require.NoError(t, sm.SaveDeepSeekAccounts(input))

	loaded, report, err := sm.LoadDeepSeekAccounts()
	require.NoError(t, err)
	assert.Empty(t, report)
	require.Len(t, loaded, 1)
	assert.Equal(t, input[0], loaded[0])
}

func TestDeepSeekAccounts_CorruptFileBackedUp(t *testing.T) {
	dir := t.TempDir()
	sm, err := NewStorageManager(dir)
	require.NoError(t, err)

	p := filepath.Join(dir, DeepSeekAccountsFileName)
	require.NoError(t, os.WriteFile(p, []byte("not valid toml === [[["), 0600))

	records, report, err := sm.LoadDeepSeekAccounts()
	require.NoError(t, err)
	assert.Empty(t, records)
	assert.Contains(t, report, "corrupted")
}

func TestDeepSeekAccounts_FutureVersionBackedUp(t *testing.T) {
	dir := t.TempDir()
	sm, err := NewStorageManager(dir)
	require.NoError(t, err)

	p := filepath.Join(dir, DeepSeekAccountsFileName)
	require.NoError(t, os.WriteFile(p, []byte("format_version = 999\naccounts = []\n"), 0600))

	records, report, err := sm.LoadDeepSeekAccounts()
	require.NoError(t, err)
	assert.Empty(t, records)
	assert.Contains(t, report, "format version 999")
}
