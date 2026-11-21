package storage

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStorage_AccountsSaveAndLoad(t *testing.T) {
	tempDir := t.TempDir()
	sm, err := NewStorageManager(tempDir)
	require.NoError(t, err)

	// Initial load when file does not exist
	accounts, report, err := sm.LoadAccounts()
	require.NoError(t, err)
	assert.Empty(t, report)
	assert.Empty(t, accounts)

	// Save accounts
	acc1 := AccountRecord{
		ID:        "acc-1",
		Email:     "user1@gmail.com",
		Name:      "User One",
		CreatedAt: "2026-11-04T00:00:00Z",
		Quota: QuotaSnapshot{
			SubscriptionTier:    "FREE",
			RemainingPercentage: 85,
			ResetTime:           "2026-11-04T05:00:00Z",
			LastRefreshedAt:     "2026-11-04T01:00:00Z",
			Groups: []QuotaGroup{
				{
					DisplayName: "Gemini",
					Buckets: []QuotaBucket{
						{BucketID: "gemini_5h", Window: "5h", RemainingFraction: 0.85, ResetTime: "2026-11-04T05:00:00Z"},
					},
				},
			},
		},
	}
	acc2 := AccountRecord{
		ID:        "acc-2",
		Email:     "user2@gmail.com",
		Name:      "User Two",
		CreatedAt: "2026-11-04T00:05:00Z",
		Quota: QuotaSnapshot{
			SubscriptionTier:    "PRO",
			RemainingPercentage: 100,
			LastRefreshedAt:     "2026-11-04T01:00:00Z",
		},
	}

	err = sm.SaveAccounts([]AccountRecord{acc1, acc2})
	require.NoError(t, err)

	// Read back and assert order and fields
	loaded, report, err := sm.LoadAccounts()
	require.NoError(t, err)
	assert.Empty(t, report)
	require.Len(t, loaded, 2)
	assert.Equal(t, "acc-1", loaded[0].ID)
	assert.Equal(t, "user1@gmail.com", loaded[0].Email)
	assert.Equal(t, "FREE", loaded[0].Quota.SubscriptionTier)
	assert.Equal(t, 85, loaded[0].Quota.RemainingPercentage)
	assert.Equal(t, "acc-2", loaded[1].ID)
	assert.Equal(t, "user2@gmail.com", loaded[1].Email)
}

func TestStorage_CorruptFileBackup(t *testing.T) {
	tempDir := t.TempDir()
	sm, err := NewStorageManager(tempDir)
	require.NoError(t, err)

	// Write garbage to accounts.toml
	p := filepath.Join(tempDir, AccountsFileName)
	err = os.WriteFile(p, []byte("NOT A VALID TOML [[["), 0644)
	require.NoError(t, err)

	accounts, report, err := sm.LoadAccounts()
	require.NoError(t, err)
	assert.NotEmpty(t, report)
	assert.Empty(t, accounts)

	// Original accounts.toml should have been renamed to backup
	_, err = os.Stat(p)
	assert.True(t, os.IsNotExist(err))

	// Find the corrupt backup file in tempDir
	entries, err := os.ReadDir(tempDir)
	require.NoError(t, err)
	var foundBackup bool
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".tmp" && len(e.Name()) > len(AccountsFileName) {
			foundBackup = true
		}
	}
	assert.True(t, foundBackup)
}

func TestStorage_UnsupportedVersionBackup(t *testing.T) {
	tempDir := t.TempDir()
	sm, err := NewStorageManager(tempDir)
	require.NoError(t, err)

	p := filepath.Join(tempDir, AccountsFileName)
	futureContent := `format_version = 999
[[accounts]]
id = "future-id"
email = "future@example.com"
name = "Future"
created_at = "2099-01-01T00:00:00Z"
`
	err = os.WriteFile(p, []byte(futureContent), 0644)
	require.NoError(t, err)

	accounts, report, err := sm.LoadAccounts()
	require.NoError(t, err)
	assert.Contains(t, report, "format version 999 > current supported")
	assert.Empty(t, accounts)
}

func TestStorage_SettingsLifecycle(t *testing.T) {
	tempDir := t.TempDir()
	sm, err := NewStorageManager(tempDir)
	require.NoError(t, err)

	sf, report, err := sm.LoadSettings()
	require.NoError(t, err)
	assert.Empty(t, report)
	assert.Equal(t, CurrentFormatVersion, sf.FormatVersion)
	assert.Empty(t, sf.ClientPath)

	sf.ClientPath = `C:\Custom\Antigravity\Antigravity.exe`
	err = sm.SaveSettings(sf)
	require.NoError(t, err)

	loaded, report, err := sm.LoadSettings()
	require.NoError(t, err)
	assert.Empty(t, report)
	assert.Equal(t, `C:\Custom\Antigravity\Antigravity.exe`, loaded.ClientPath)
}

func TestStorage_MigrateLegacyCodeToolDir(t *testing.T) {
	tempRoot := t.TempDir()
	legacyDir := filepath.Join(tempRoot, LegacyAppDirName)
	newDir := filepath.Join(tempRoot, AppDirName)
	require.NoError(t, os.MkdirAll(legacyDir, 0755))
	require.NoError(t, os.MkdirAll(newDir, 0755))

	legacySM, err := NewStorageManager(legacyDir)
	require.NoError(t, err)
	require.NoError(t, legacySM.SaveAccounts([]AccountRecord{
		{ID: "acc-legacy", Email: "legacy@example.com", Name: "Legacy"},
	}))
	require.NoError(t, legacySM.SaveSettings(&SettingsFile{
		FormatVersion: CurrentFormatVersion,
		Theme:         "dark",
	}))

	// Existing settings.toml in newDir must NOT be overwritten
	newSM, err := NewStorageManager(newDir)
	require.NoError(t, err)
	require.NoError(t, newSM.SaveSettings(&SettingsFile{
		FormatVersion: CurrentFormatVersion,
		Theme:         "light",
	}))

	newSM.migrateLegacyFiles(legacyDir)

	accounts, report, err := newSM.LoadAccounts()
	require.NoError(t, err)
	assert.Empty(t, report)
	require.Len(t, accounts, 1)
	assert.Equal(t, "acc-legacy", accounts[0].ID)

	sf, _, err := newSM.LoadSettings()
	require.NoError(t, err)
	assert.Equal(t, "light", sf.Theme)
}
