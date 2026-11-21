package main

import (
	_ "embed"

	"codetool/internal/buildinfo"
)

//go:embed VERSION
var embeddedVersion string

//go:embed changelog.json
var embeddedChangelog []byte

// GetAppInfo returns runtime version, release channel, commit SHA, and build timestamp.
func (a *App) GetAppInfo() buildinfo.AppInfo {
	return buildinfo.Current(embeddedVersion)
}

// GetChangelog returns structured release notes parsed from embedded changelog.json.
func (a *App) GetChangelog() []buildinfo.ChangelogRelease {
	releases, err := buildinfo.ParseChangelog(embeddedChangelog)
	if err != nil {
		return []buildinfo.ChangelogRelease{}
	}
	return releases
}
