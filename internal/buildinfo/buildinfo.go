package buildinfo

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// Build-time variables injected via -ldflags during release builds.
var (
	Version   = ""
	Commit    = "dev"
	BuildTime = "dev"
)

const (
	ChannelStable = "stable"
	ChannelRC     = "rc"
	ChannelDev    = "dev"
)

var semverPattern = regexp.MustCompile(`^(\d+\.\d+\.\d+)(?:-rc\.([1-9]\d*))?$`)

var validChangeTypes = map[string]bool{
	"feat":     true,
	"fix":      true,
	"perf":     true,
	"change":   true,
	"breaking": true,
}

// AppInfo represents runtime version and build metadata exposed to the frontend.
type AppInfo struct {
	Version        string `json:"version"`
	NumericVersion string `json:"numericVersion"`
	Channel        string `json:"channel"`
	Commit         string `json:"commit"`
	BuildTime      string `json:"buildTime"`
}

// ChangelogChange represents a single structured change item within a release.
type ChangelogChange struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// ChangelogRelease represents a single release entry in changelog.json.
type ChangelogRelease struct {
	Version string            `json:"version"`
	Date    string            `json:"date"`
	Channel string            `json:"channel"`
	Title   string            `json:"title"`
	Summary string            `json:"summary"`
	Changes []ChangelogChange `json:"changes"`
}

// ChangelogFile is the top-level JSON structure of changelog.json.
type ChangelogFile struct {
	Releases []ChangelogRelease `json:"releases"`
}

// ParseVersion validates a Graviton SemVer string (X.Y.Z or X.Y.Z-rc.N)
// and returns the 3-part Windows numeric version and release channel.
func ParseVersion(v string) (numeric string, channel string, err error) {
	trimmed := strings.TrimSpace(v)
	matches := semverPattern.FindStringSubmatch(trimmed)
	if matches == nil {
		return "", "", fmt.Errorf("invalid version %q: expected X.Y.Z or X.Y.Z-rc.N (N >= 1)", v)
	}
	numeric = matches[1]
	if matches[2] != "" {
		return numeric, ChannelRC, nil
	}
	return numeric, ChannelStable, nil
}

// Current builds the runtime AppInfo using ldflags values with fallback to embedded VERSION.
func Current(embeddedVersion string) AppInfo {
	ver := strings.TrimSpace(Version)
	injected := ver != ""
	if !injected {
		ver = strings.TrimSpace(embeddedVersion)
	}
	if ver == "" {
		ver = "0.0.0"
	}

	numeric, ch, err := ParseVersion(ver)
	if err != nil {
		numeric = "0.0.0"
		ch = ChannelDev
	}
	if !injected && Commit == "dev" {
		ch = ChannelDev
	}

	return AppInfo{
		Version:        ver,
		NumericVersion: numeric,
		Channel:        ch,
		Commit:         Commit,
		BuildTime:      BuildTime,
	}
}

// WindowTitle returns the main window title reflecting the release channel.
// Stable builds show the clean appName; RC/dev builds include a clear channel indicator.
func (a AppInfo) WindowTitle(appName string) string {
	switch a.Channel {
	case ChannelRC:
		return fmt.Sprintf("%s v%s (RC)", appName, a.Version)
	case ChannelDev:
		return fmt.Sprintf("%s (Dev)", appName)
	default:
		return appName
	}
}

// TrayTooltip returns the Windows system tray hover tooltip reflecting the release channel.
func (a AppInfo) TrayTooltip(appName string) string {
	switch a.Channel {
	case ChannelRC:
		return fmt.Sprintf("%s v%s (RC) - Antigravity 额度管理", appName, a.Version)
	case ChannelDev:
		return fmt.Sprintf("%s (Dev) - Antigravity 额度管理", appName)
	default:
		return fmt.Sprintf("%s - Antigravity 额度管理", appName)
	}
}

// ParseChangelog parses and validates changelog.json bytes into typed release entries.
func ParseChangelog(raw []byte) ([]ChangelogRelease, error) {
	var cf ChangelogFile
	if err := json.Unmarshal(raw, &cf); err != nil {
		return nil, fmt.Errorf("parse changelog.json: %w", err)
	}

	releases := make([]ChangelogRelease, 0, len(cf.Releases))
	seen := make(map[string]bool, len(cf.Releases))
	for i, r := range cf.Releases {
		ver := strings.TrimSpace(r.Version)
		_, ch, err := ParseVersion(ver)
		if err != nil {
			return nil, fmt.Errorf("releases[%d]: %w", i, err)
		}
		if seen[ver] {
			return nil, fmt.Errorf("releases[%d]: duplicate version %q", i, ver)
		}
		seen[ver] = true

		if strings.TrimSpace(r.Date) == "" {
			return nil, fmt.Errorf("releases[%d] (%s): date is required", i, ver)
		}
		if len(r.Changes) == 0 {
			return nil, fmt.Errorf("releases[%d] (%s): at least one change entry is required", i, ver)
		}

		changes := make([]ChangelogChange, 0, len(r.Changes))
		for j, c := range r.Changes {
			ct := strings.TrimSpace(c.Type)
			if !validChangeTypes[ct] {
				return nil, fmt.Errorf("releases[%d].changes[%d] (%s): invalid type %q", i, j, ver, c.Type)
			}
			text := strings.TrimSpace(c.Text)
			if text == "" {
				return nil, fmt.Errorf("releases[%d].changes[%d] (%s): text is required", i, j, ver)
			}
			changes = append(changes, ChangelogChange{
				Type: ct,
				Text: text,
			})
		}

		releases = append(releases, ChangelogRelease{
			Version: ver,
			Date:    strings.TrimSpace(r.Date),
			Channel: ch,
			Title:   strings.TrimSpace(r.Title),
			Summary: strings.TrimSpace(r.Summary),
			Changes: changes,
		})
	}

	return releases, nil
}
