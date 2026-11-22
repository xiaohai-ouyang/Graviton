package storage

import (
	"fmt"
	"os"
	"path/filepath"

	toml "github.com/pelletier/go-toml/v2"
)

const QianwenAccountsFileName = "qianwen_accounts.toml"

// QianwenUsageCycle represents a single Token Plan usage cycle (e.g. monthly, weekly, 5h).
type QianwenUsageCycle struct {
	Cycle               string   `toml:"cycle" json:"cycle"`
	Label               string   `toml:"label" json:"label"`
	UsedPercentage      float64  `toml:"used_percentage" json:"usedPercentage"`
	RemainingPercentage float64  `toml:"remaining_percentage" json:"remainingPercentage"`
	ResetTime           string   `toml:"reset_time,omitempty" json:"resetTime,omitempty"`
	TotalQuota          *float64 `toml:"total_quota,omitempty" json:"totalQuota,omitempty"`
}

// QianwenPersonalPlan represents an individual Token Plan subscription and usage snapshot.
type QianwenPersonalPlan struct {
	Status        string              `toml:"status" json:"status"`
	SpecCode      string              `toml:"spec_code,omitempty" json:"specCode,omitempty"`
	PlanName      string              `toml:"plan_name,omitempty" json:"planName,omitempty"`
	InstanceCode  string              `toml:"instance_code,omitempty" json:"instanceCode,omitempty"`
	StartTime     string              `toml:"start_time,omitempty" json:"startTime,omitempty"`
	EndTime       string              `toml:"end_time,omitempty" json:"endTime,omitempty"`
	RemainingDays int                 `toml:"remaining_days" json:"remainingDays"`
	AutoRenew     bool                `toml:"auto_renew" json:"autoRenew"`
	Cycles        []QianwenUsageCycle `toml:"cycles" json:"cycles"`
}

// QianwenTeamSeatGroup represents a seat tier summary in a team Token Plan subscription.
type QianwenTeamSeatGroup struct {
	SpecType            string  `toml:"spec_type" json:"specType"`
	Seats               int     `toml:"seats" json:"seats"`
	Assigned            int     `toml:"assigned" json:"assigned"`
	TotalCredits        float64 `toml:"total_credits" json:"totalCredits"`
	RemainingCredits    float64 `toml:"remaining_credits" json:"remainingCredits"`
	UsedPercentage      float64 `toml:"used_percentage" json:"usedPercentage"`
	RemainingPercentage float64 `toml:"remaining_percentage" json:"remainingPercentage"`
	NextResetTime       string  `toml:"next_reset_time,omitempty" json:"nextResetTime,omitempty"`
}

// QianwenTeamPlan represents a team Token Plan subscription and credits snapshot.
type QianwenTeamPlan struct {
	Status              string                 `toml:"status" json:"status"`
	PlanName            string                 `toml:"plan_name,omitempty" json:"planName,omitempty"`
	InstanceID          string                 `toml:"instance_id,omitempty" json:"instanceId,omitempty"`
	StartTime           string                 `toml:"start_time,omitempty" json:"startTime,omitempty"`
	EndTime             string                 `toml:"end_time,omitempty" json:"endTime,omitempty"`
	RemainingDays       int                    `toml:"remaining_days" json:"remainingDays"`
	AutoRenew           *bool                  `toml:"auto_renew,omitempty" json:"autoRenew,omitempty"`
	TotalCredits        float64                `toml:"total_credits" json:"totalCredits"`
	RemainingCredits    float64                `toml:"remaining_credits" json:"remainingCredits"`
	UsedPercentage      float64                `toml:"used_percentage" json:"usedPercentage"`
	RemainingPercentage float64                `toml:"remaining_percentage" json:"remainingPercentage"`
	ResetTime           string                 `toml:"reset_time,omitempty" json:"resetTime,omitempty"`
	AddonRemaining      float64                `toml:"addon_remaining" json:"addonRemaining"`
	SeatGroups          []QianwenTeamSeatGroup `toml:"seat_groups" json:"seatGroups"`
}

// QianwenQuotaSnapshot stores the persisted Token Plan quota snapshot for a Qianwen account.
type QianwenQuotaSnapshot struct {
	HasSubscription bool                 `toml:"has_subscription" json:"hasSubscription"`
	AuthExpired     bool                 `toml:"auth_expired" json:"authExpired"`
	LastRefreshedAt string               `toml:"last_refreshed_at" json:"lastRefreshedAt"`
	ErrorMessage    string               `toml:"error_message,omitempty" json:"errorMessage,omitempty"`
	Personal        *QianwenPersonalPlan `toml:"personal,omitempty" json:"personal,omitempty"`
	Team            *QianwenTeamPlan     `toml:"team,omitempty" json:"team,omitempty"`
}

// QianwenAccountRecord represents a sanitized Qianwen account entry persisted in TOML.
type QianwenAccountRecord struct {
	ID             string               `toml:"id" json:"id"`
	UserID         string               `toml:"user_id,omitempty" json:"userId,omitempty"`
	AliyunID       string               `toml:"aliyun_id,omitempty" json:"aliyunId,omitempty"`
	Email          string               `toml:"email,omitempty" json:"email,omitempty"`
	Name           string               `toml:"name" json:"name"`
	TokenExpiresAt string               `toml:"token_expires_at,omitempty" json:"tokenExpiresAt,omitempty"`
	CreatedAt      string               `toml:"created_at" json:"createdAt"`
	Quota          QianwenQuotaSnapshot `toml:"quota" json:"quota"`
}

// QianwenAccountsFile represents the TOML schema of qianwen_accounts.toml.
type QianwenAccountsFile struct {
	FormatVersion int                    `toml:"format_version"`
	Accounts      []QianwenAccountRecord `toml:"accounts"`
}

func (sm *StorageManager) qianwenAccountsPath() string {
	return filepath.Join(sm.baseDir, QianwenAccountsFileName)
}

// LoadQianwenAccounts loads qianwen_accounts.toml, backing up corrupt or newer-version files.
func (sm *StorageManager) LoadQianwenAccounts() ([]QianwenAccountRecord, string, error) {
	p := sm.qianwenAccountsPath()
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return []QianwenAccountRecord{}, "", nil
		}
		return nil, "", fmt.Errorf("failed to read qianwen accounts file: %w", err)
	}

	var af QianwenAccountsFile
	if err := toml.Unmarshal(data, &af); err != nil {
		backupPath := sm.backupCorruptFile(p)
		report := fmt.Sprintf("qianwen_accounts.toml is corrupted (%v); backed up to %s", err, filepath.Base(backupPath))
		return []QianwenAccountRecord{}, report, nil
	}

	if af.FormatVersion > CurrentFormatVersion {
		backupPath := sm.backupCorruptFile(p)
		report := fmt.Sprintf("qianwen_accounts.toml format version %d > current supported %d; backed up to %s", af.FormatVersion, CurrentFormatVersion, filepath.Base(backupPath))
		return []QianwenAccountRecord{}, report, nil
	}

	if af.Accounts == nil {
		af.Accounts = []QianwenAccountRecord{}
	}
	return af.Accounts, "", nil
}

// SaveQianwenAccounts atomically saves Qianwen account records to qianwen_accounts.toml.
func (sm *StorageManager) SaveQianwenAccounts(accounts []QianwenAccountRecord) error {
	af := QianwenAccountsFile{
		FormatVersion: CurrentFormatVersion,
		Accounts:      accounts,
	}
	if af.Accounts == nil {
		af.Accounts = []QianwenAccountRecord{}
	}

	data, err := toml.Marshal(af)
	if err != nil {
		return fmt.Errorf("failed to marshal qianwen accounts to TOML: %w", err)
	}

	return sm.atomicWrite(sm.qianwenAccountsPath(), data)
}
