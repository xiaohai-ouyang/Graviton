package storage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	toml "github.com/pelletier/go-toml/v2"
)

const (
	CurrentFormatVersion = 1
	AccountsFileName     = "accounts.toml"
	SettingsFileName     = "settings.toml"
	AppDirName           = "CodeTool"
)

// QuotaBucket represents a single quota bucket/window (e.g. 5h window or weekly).
type QuotaBucket struct {
	BucketID          string  `toml:"bucket_id" json:"bucketId"`
	Window            string  `toml:"window" json:"window"`
	RemainingFraction float64 `toml:"remaining_fraction" json:"remainingFraction"`
	ResetTime         string  `toml:"reset_time" json:"resetTime"`
	DisplayName       string  `toml:"display_name,omitempty" json:"displayName,omitempty"`
	Description       string  `toml:"description,omitempty" json:"description,omitempty"`
}

// QuotaGroup represents a group of buckets (e.g. Claude / Gemini / Argon).
type QuotaGroup struct {
	DisplayName string        `toml:"display_name" json:"displayName"`
	Description string        `toml:"description,omitempty" json:"description,omitempty"`
	Buckets     []QuotaBucket `toml:"buckets" json:"buckets"`
}

// ModelQuota represents quota for a specific model.
type ModelQuota struct {
	Name        string `toml:"name" json:"name"`
	DisplayName string `toml:"display_name,omitempty" json:"displayName,omitempty"`
	Percentage  int    `toml:"percentage" json:"percentage"`
	ResetTime   string `toml:"reset_time,omitempty" json:"resetTime,omitempty"`
}

// QuotaSnapshot contains the parsed quota information for an account.
type QuotaSnapshot struct {
	SubscriptionTier    string       `toml:"subscription_tier" json:"subscriptionTier"`
	RemainingPercentage int          `toml:"remaining_percentage" json:"remainingPercentage"`
	ResetTime           string       `toml:"reset_time,omitempty" json:"resetTime,omitempty"`
	LastRefreshedAt     string       `toml:"last_refreshed_at" json:"lastRefreshedAt"`
	Groups              []QuotaGroup `toml:"groups" json:"groups"`
	Models              []ModelQuota `toml:"models" json:"models"`
	IsForbidden         bool         `toml:"is_forbidden" json:"isForbidden"`
	ErrorMessage        string       `toml:"error_message,omitempty" json:"errorMessage,omitempty"`
}

// AccountRecord represents a single account saved in accounts.toml.
type AccountRecord struct {
	ID             string        `toml:"id" json:"id"`
	Email          string        `toml:"email" json:"email"`
	Name           string        `toml:"name" json:"name"`
	LastSwitchedAt string        `toml:"last_switched_at,omitempty" json:"lastSwitchedAt,omitempty"`
	CreatedAt      string        `toml:"created_at" json:"createdAt"`
	Quota          QuotaSnapshot `toml:"quota" json:"quota"`
}

// AccountsFile represents the structure of accounts.toml.
type AccountsFile struct {
	FormatVersion int             `toml:"format_version"`
	Accounts      []AccountRecord `toml:"accounts"`
}

// SettingsFile represents the structure of settings.toml.
type SettingsFile struct {
	FormatVersion int    `toml:"format_version"`
	ClientPath    string `toml:"client_path,omitempty"`
	WidgetEnabled bool   `toml:"widget_enabled,omitempty"`
	WidgetX       int    `toml:"widget_x,omitempty"`
	WidgetY       int    `toml:"widget_y,omitempty"`
	WidgetHasPos  bool   `toml:"widget_has_pos,omitempty"`
	WidgetLocked      bool   `toml:"widget_locked,omitempty"`
	WidgetAlwaysOnTop bool   `toml:"widget_always_on_top,omitempty"`
	Theme             string `toml:"theme,omitempty"`
}

// StorageManager manages loading and atomic saving of configuration and accounts.
type StorageManager struct {
	baseDir string
}

// NewStorageManager creates a StorageManager using the specified base directory.
// If baseDir is empty, it defaults to %LOCALAPPDATA%\CodeTool.
func NewStorageManager(baseDir string) (*StorageManager, error) {
	if baseDir == "" {
		localAppData := os.Getenv("LOCALAPPDATA")
		if localAppData == "" {
			return nil, errors.New("LOCALAPPDATA environment variable is empty")
		}
		baseDir = filepath.Join(localAppData, AppDirName)
	}

	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory %s: %w", baseDir, err)
	}

	return &StorageManager{baseDir: baseDir}, nil
}

// BaseDir returns the root storage directory.
func (sm *StorageManager) BaseDir() string {
	return sm.baseDir
}

func (sm *StorageManager) accountsPath() string {
	return filepath.Join(sm.baseDir, AccountsFileName)
}

func (sm *StorageManager) settingsPath() string {
	return filepath.Join(sm.baseDir, SettingsFileName)
}

// LoadAccounts loads accounts.toml. If corrupted or version is newer, it backs up the file
// and returns an empty list plus a descriptive error.
func (sm *StorageManager) LoadAccounts() ([]AccountRecord, string, error) {
	p := sm.accountsPath()
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return []AccountRecord{}, "", nil
		}
		return nil, "", fmt.Errorf("failed to read accounts file: %w", err)
	}

	var af AccountsFile
	if err := toml.Unmarshal(data, &af); err != nil {
		backupPath := sm.backupCorruptFile(p)
		report := fmt.Sprintf("accounts.toml is corrupted (%v); backed up to %s", err, filepath.Base(backupPath))
		return []AccountRecord{}, report, nil
	}

	if af.FormatVersion > CurrentFormatVersion {
		backupPath := sm.backupCorruptFile(p)
		report := fmt.Sprintf("accounts.toml format version %d > current supported %d; backed up to %s", af.FormatVersion, CurrentFormatVersion, filepath.Base(backupPath))
		return []AccountRecord{}, report, nil
	}

	if af.Accounts == nil {
		af.Accounts = []AccountRecord{}
	}
	return af.Accounts, "", nil
}

// SaveAccounts atomically saves the account records to accounts.toml.
func (sm *StorageManager) SaveAccounts(accounts []AccountRecord) error {
	af := AccountsFile{
		FormatVersion: CurrentFormatVersion,
		Accounts:      accounts,
	}
	if af.Accounts == nil {
		af.Accounts = []AccountRecord{}
	}

	data, err := toml.Marshal(af)
	if err != nil {
		return fmt.Errorf("failed to marshal accounts to TOML: %w", err)
	}

	return sm.atomicWrite(sm.accountsPath(), data)
}

// LoadSettings loads settings.toml. If corrupted or version newer, backs up and returns defaults.
func (sm *StorageManager) LoadSettings() (*SettingsFile, string, error) {
	p := sm.settingsPath()
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return &SettingsFile{FormatVersion: CurrentFormatVersion}, "", nil
		}
		return nil, "", fmt.Errorf("failed to read settings file: %w", err)
	}

	var sf SettingsFile
	if err := toml.Unmarshal(data, &sf); err != nil {
		backupPath := sm.backupCorruptFile(p)
		report := fmt.Sprintf("settings.toml is corrupted (%v); backed up to %s", err, filepath.Base(backupPath))
		return &SettingsFile{FormatVersion: CurrentFormatVersion}, report, nil
	}

	if sf.FormatVersion > CurrentFormatVersion {
		backupPath := sm.backupCorruptFile(p)
		report := fmt.Sprintf("settings.toml format version %d > current %d; backed up to %s", sf.FormatVersion, CurrentFormatVersion, filepath.Base(backupPath))
		return &SettingsFile{FormatVersion: CurrentFormatVersion}, report, nil
	}

	return &sf, "", nil
}

// SaveSettings atomically saves settings.toml.
func (sm *StorageManager) SaveSettings(sf *SettingsFile) error {
	sf.FormatVersion = CurrentFormatVersion
	data, err := toml.Marshal(sf)
	if err != nil {
		return fmt.Errorf("failed to marshal settings to TOML: %w", err)
	}

	return sm.atomicWrite(sm.settingsPath(), data)
}

func (sm *StorageManager) backupCorruptFile(origPath string) string {
	timestamp := time.Now().Format("20060102-150405")
	backupPath := fmt.Sprintf("%s.corrupt.%s", origPath, timestamp)
	_ = os.Rename(origPath, backupPath)
	return backupPath
}

// atomicWrite writes data to a temporary file in the same directory, syncs, closes,
// and atomically replaces the target file.
func (sm *StorageManager) atomicWrite(targetPath string, data []byte) error {
	dir := filepath.Dir(targetPath)
	tmpFile, err := os.CreateTemp(dir, filepath.Base(targetPath)+".*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temporary file: %w", err)
	}
	tmpName := tmpFile.Name()
	defer func() {
		_ = os.Remove(tmpName)
	}()

	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("failed to write to temporary file: %w", err)
	}

	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("failed to sync temporary file: %w", err)
	}

	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("failed to close temporary file: %w", err)
	}

	if err := ReplaceFile(tmpName, targetPath); err != nil {
		return fmt.Errorf("failed to atomic replace %s with %s: %w", targetPath, tmpName, err)
	}

	return nil
}
