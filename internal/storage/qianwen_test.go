package storage

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStorage_QianwenAccountsSaveAndLoad(t *testing.T) {
	tempDir := t.TempDir()
	sm, err := NewStorageManager(tempDir)
	require.NoError(t, err)

	accounts, report, err := sm.LoadQianwenAccounts()
	require.NoError(t, err)
	assert.Empty(t, report)
	assert.Empty(t, accounts)

	monthlyQuota := 18000.0
	autoRenew := true
	records := []QianwenAccountRecord{
		{
			ID:             "qw-1",
			UserID:         "u-123",
			AliyunID:       "1234567890",
			Email:          "qw@example.com",
			Name:           "qw@example.com",
			TokenExpiresAt: "2026-12-01T00:00:00Z",
			CreatedAt:      "2026-11-22T10:00:00Z",
			Quota: QianwenQuotaSnapshot{
				HasSubscription: true,
				LastRefreshedAt: "2026-11-22T10:01:00Z",
				Personal: &QianwenPersonalPlan{
					Status:        "active",
					SpecCode:      "pro",
					PlanName:      "Pro",
					InstanceCode:  "inst-p-1",
					StartTime:     "2026-11-01T00:00:00Z",
					EndTime:       "2026-12-01T00:00:00Z",
					RemainingDays: 9,
					AutoRenew:     true,
					Cycles: []QianwenUsageCycle{
						{
							Cycle:               "monthly",
							Label:               "月度额度",
							UsedPercentage:      25,
							RemainingPercentage: 75,
							ResetTime:           "2026-12-01T00:00:00Z",
							TotalQuota:          &monthlyQuota,
						},
					},
				},
				Team: &QianwenTeamPlan{
					Status:              "active",
					PlanName:            "Team Plan",
					InstanceID:          "inst-t-1",
					StartTime:           "2026-11-01T00:00:00Z",
					EndTime:             "2026-12-01T00:00:00Z",
					RemainingDays:       9,
					AutoRenew:           &autoRenew,
					TotalCredits:        1000,
					RemainingCredits:    750,
					UsedPercentage:      25,
					RemainingPercentage: 75,
					ResetTime:           "2026-12-01T00:00:00Z",
					AddonRemaining:      120,
					SeatGroups: []QianwenTeamSeatGroup{
						{
							SpecType:            "pro",
							Seats:               5,
							Assigned:            3,
							TotalCredits:        1000,
							RemainingCredits:    750,
							UsedPercentage:      25,
							RemainingPercentage: 75,
							NextResetTime:       "2026-12-01T00:00:00Z",
						},
					},
				},
			},
		},
	}

	require.NoError(t, sm.SaveQianwenAccounts(records))

	loaded, report, err := sm.LoadQianwenAccounts()
	require.NoError(t, err)
	assert.Empty(t, report)
	require.Len(t, loaded, 1)

	got := loaded[0]
	assert.Equal(t, "qw-1", got.ID)
	assert.Equal(t, "1234567890", got.AliyunID)
	assert.True(t, got.Quota.HasSubscription)
	require.NotNil(t, got.Quota.Personal)
	assert.Equal(t, "pro", got.Quota.Personal.SpecCode)
	require.Len(t, got.Quota.Personal.Cycles, 1)
	assert.Equal(t, 75.0, got.Quota.Personal.Cycles[0].RemainingPercentage)
	require.NotNil(t, got.Quota.Personal.Cycles[0].TotalQuota)
	assert.Equal(t, 18000.0, *got.Quota.Personal.Cycles[0].TotalQuota)

	require.NotNil(t, got.Quota.Team)
	assert.Equal(t, 120.0, got.Quota.Team.AddonRemaining)
	require.NotNil(t, got.Quota.Team.AutoRenew)
	assert.True(t, *got.Quota.Team.AutoRenew)
	require.Len(t, got.Quota.Team.SeatGroups, 1)
	assert.Equal(t, 3, got.Quota.Team.SeatGroups[0].Assigned)
}

func TestStorage_QianwenCorruptBackup(t *testing.T) {
	tempDir := t.TempDir()
	sm, err := NewStorageManager(tempDir)
	require.NoError(t, err)

	p := filepath.Join(tempDir, QianwenAccountsFileName)
	require.NoError(t, os.WriteFile(p, []byte("invalid toml [[["), 0644))

	accounts, report, err := sm.LoadQianwenAccounts()
	require.NoError(t, err)
	assert.NotEmpty(t, report)
	assert.Empty(t, accounts)
	_, err = os.Stat(p)
	assert.True(t, os.IsNotExist(err))
}
