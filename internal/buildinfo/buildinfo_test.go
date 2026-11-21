package buildinfo

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseVersion(t *testing.T) {
	tests := []struct {
		input   string
		numeric string
		channel string
		wantErr bool
	}{
		{"0.1.0", "0.1.0", ChannelStable, false},
		{"0.1.1", "0.1.1", ChannelStable, false},
		{"1.2.3", "1.2.3", ChannelStable, false},
		{"0.1.0-rc.1", "0.1.0", ChannelRC, false},
		{"0.1.1-rc.12", "0.1.1", ChannelRC, false},
		{"0.1.1.RC", "", "", true},
		{"0.1.1-rc.0", "", "", true},
		{"v0.1.0", "", "", true},
		{"0.1", "", "", true},
		{"0.1.0-beta.1", "", "", true},
		{"", "", "", true},
	}

	for _, tc := range tests {
		num, ch, err := ParseVersion(tc.input)
		if tc.wantErr {
			assert.Error(t, err, "input=%q", tc.input)
		} else {
			require.NoError(t, err, "input=%q", tc.input)
			assert.Equal(t, tc.numeric, num, "input=%q", tc.input)
			assert.Equal(t, tc.channel, ch, "input=%q", tc.input)
		}
	}
}

func TestCurrent(t *testing.T) {
	origVersion, origCommit, origBuildTime := Version, Commit, BuildTime
	t.Cleanup(func() {
		Version, Commit, BuildTime = origVersion, origCommit, origBuildTime
	})

	// Local dev fallback (no ldflags)
	Version, Commit, BuildTime = "", "dev", "dev"
	info := Current("0.1.0-rc.1\n")
	assert.Equal(t, "0.1.0-rc.1", info.Version)
	assert.Equal(t, "0.1.0", info.NumericVersion)
	assert.Equal(t, ChannelDev, info.Channel)

	// Injected RC release build
	Version, Commit, BuildTime = "0.1.0-rc.1", "6d04fac", "2026-11-21T12:00:00Z"
	info = Current("0.1.0-rc.1")
	assert.Equal(t, "0.1.0-rc.1", info.Version)
	assert.Equal(t, "0.1.0", info.NumericVersion)
	assert.Equal(t, ChannelRC, info.Channel)
	assert.Equal(t, "6d04fac", info.Commit)

	// Injected stable release build
	Version, Commit, BuildTime = "0.1.0", "abcdef1", "2026-11-22T00:00:00Z"
	info = Current("0.1.0")
	assert.Equal(t, "0.1.0", info.Version)
	assert.Equal(t, "0.1.0", info.NumericVersion)
	assert.Equal(t, ChannelStable, info.Channel)
}

func TestRepoVersionAndChangelogInSync(t *testing.T) {
	root := filepath.Join("..", "..")

	versionBytes, err := os.ReadFile(filepath.Join(root, "VERSION"))
	require.NoError(t, err)
	ver := strings.TrimSpace(string(versionBytes))

	numeric, _, err := ParseVersion(ver)
	require.NoError(t, err)

	// Check wails.json info.productVersion matches numeric X.Y.Z
	wailsBytes, err := os.ReadFile(filepath.Join(root, "wails.json"))
	require.NoError(t, err)
	var wailsCfg struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
			ProductName    string `json:"productName"`
			CompanyName    string `json:"companyName"`
		} `json:"info"`
	}
	require.NoError(t, json.Unmarshal(wailsBytes, &wailsCfg))
	assert.Equal(t, numeric, wailsCfg.Info.ProductVersion, "wails.json info.productVersion must match numeric part of VERSION")
	assert.NotEmpty(t, wailsCfg.Info.ProductName)
	assert.NotEmpty(t, wailsCfg.Info.CompanyName)

	// Check frontend/package.json matches full VERSION
	pkgBytes, err := os.ReadFile(filepath.Join(root, "frontend", "package.json"))
	require.NoError(t, err)
	var pkg struct {
		Version string `json:"version"`
	}
	require.NoError(t, json.Unmarshal(pkgBytes, &pkg))
	assert.Equal(t, ver, pkg.Version, "frontend/package.json version must match VERSION")

	// Check changelog.json is valid and contains the current VERSION
	changelogBytes, err := os.ReadFile(filepath.Join(root, "changelog.json"))
	require.NoError(t, err)
	releases, err := ParseChangelog(changelogBytes)
	require.NoError(t, err)
	require.NotEmpty(t, releases)

	found := false
	for _, r := range releases {
		if r.Version == ver {
			found = true
			break
		}
	}
	assert.True(t, found, "changelog.json must contain an entry for current VERSION %q", ver)
}
