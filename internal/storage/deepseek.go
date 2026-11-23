package storage

import (
	"fmt"
	"os"
	"path/filepath"

	toml "github.com/pelletier/go-toml/v2"
)

const DeepSeekAccountsFileName = "deepseek_accounts.toml"

// DeepSeekBalanceInfo represents balance details for a single currency returned by DeepSeek.
type DeepSeekBalanceInfo struct {
	Currency        string `toml:"currency" json:"currency"`
	TotalBalance    string `toml:"total_balance" json:"totalBalance"`
	GrantedBalance  string `toml:"granted_balance" json:"grantedBalance"`
	ToppedUpBalance string `toml:"topped_up_balance" json:"toppedUpBalance"`
}

// DeepSeekBalanceSnapshot stores the persisted balance snapshot for a DeepSeek account.
type DeepSeekBalanceSnapshot struct {
	IsAvailable     bool                  `toml:"is_available" json:"isAvailable"`
	BalanceInfos    []DeepSeekBalanceInfo `toml:"balance_infos" json:"balanceInfos"`
	AuthInvalid     bool                  `toml:"auth_invalid" json:"authInvalid"`
	LastRefreshedAt string                `toml:"last_refreshed_at" json:"lastRefreshedAt"`
	ErrorMessage    string                `toml:"error_message,omitempty" json:"errorMessage,omitempty"`
}

// DeepSeekAccountRecord represents a sanitized DeepSeek account entry persisted in TOML.
// The raw API key is never stored here; it lives exclusively in Windows Credential Manager.
type DeepSeekAccountRecord struct {
	ID             string                  `toml:"id" json:"id"`
	Name           string                  `toml:"name" json:"name"`
	KeyPreview     string                  `toml:"key_preview" json:"keyPreview"`
	KeyFingerprint string                  `toml:"key_fingerprint,omitempty" json:"-"`
	CreatedAt      string                  `toml:"created_at" json:"createdAt"`
	Balance        DeepSeekBalanceSnapshot `toml:"balance" json:"balance"`
}

// DeepSeekAccountsFile represents the TOML schema of deepseek_accounts.toml.
type DeepSeekAccountsFile struct {
	FormatVersion int                     `toml:"format_version"`
	Accounts      []DeepSeekAccountRecord `toml:"accounts"`
}

func (sm *StorageManager) deepSeekAccountsPath() string {
	return filepath.Join(sm.baseDir, DeepSeekAccountsFileName)
}

// LoadDeepSeekAccounts loads deepseek_accounts.toml, backing up corrupt or newer-version files.
func (sm *StorageManager) LoadDeepSeekAccounts() ([]DeepSeekAccountRecord, string, error) {
	p := sm.deepSeekAccountsPath()
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return []DeepSeekAccountRecord{}, "", nil
		}
		return nil, "", fmt.Errorf("failed to read deepseek accounts file: %w", err)
	}

	var af DeepSeekAccountsFile
	if err := toml.Unmarshal(data, &af); err != nil {
		backupPath := sm.backupCorruptFile(p)
		report := fmt.Sprintf("deepseek_accounts.toml is corrupted (%v); backed up to %s", err, filepath.Base(backupPath))
		return []DeepSeekAccountRecord{}, report, nil
	}

	if af.FormatVersion > CurrentFormatVersion {
		backupPath := sm.backupCorruptFile(p)
		report := fmt.Sprintf("deepseek_accounts.toml format version %d > current supported %d; backed up to %s", af.FormatVersion, CurrentFormatVersion, filepath.Base(backupPath))
		return []DeepSeekAccountRecord{}, report, nil
	}

	if af.Accounts == nil {
		af.Accounts = []DeepSeekAccountRecord{}
	}
	for i := range af.Accounts {
		if af.Accounts[i].Balance.BalanceInfos == nil {
			af.Accounts[i].Balance.BalanceInfos = []DeepSeekBalanceInfo{}
		}
	}
	return af.Accounts, "", nil
}

// SaveDeepSeekAccounts atomically saves DeepSeek account records to deepseek_accounts.toml.
func (sm *StorageManager) SaveDeepSeekAccounts(accounts []DeepSeekAccountRecord) error {
	af := DeepSeekAccountsFile{
		FormatVersion: CurrentFormatVersion,
		Accounts:      accounts,
	}
	if af.Accounts == nil {
		af.Accounts = []DeepSeekAccountRecord{}
	}

	data, err := toml.Marshal(af)
	if err != nil {
		return fmt.Errorf("failed to marshal deepseek accounts to TOML: %w", err)
	}

	return sm.atomicWrite(sm.deepSeekAccountsPath(), data)
}
