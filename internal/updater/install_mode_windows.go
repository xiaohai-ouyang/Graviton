//go:build windows

package updater

import (
	"os"
	"path/filepath"
	"strings"

	"graviton/internal/buildinfo"

	"golang.org/x/sys/windows/registry"
)

// InstallMode describes how the running binary was distributed.
type InstallMode string

const (
	ModeNSIS     InstallMode = "nsis"
	ModePortable InstallMode = "portable"
	ModeDev      InstallMode = "dev"
)

const uninstallRegSubKey = `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\GravitonGraviton`

// DetectInstallMode classifies the running executable as NSIS-installed, portable, or dev.
func DetectInstallMode(channel, exePath string) InstallMode {
	if channel == buildinfo.ChannelDev {
		return ModeDev
	}
	dir := filepath.Dir(exePath)
	if _, err := os.Stat(filepath.Join(dir, "uninstall.exe")); err == nil {
		return ModeNSIS
	}
	for _, root := range []registry.Key{registry.LOCAL_MACHINE, registry.CURRENT_USER} {
		for _, view := range []uint32{registry.WOW64_64KEY, registry.WOW64_32KEY} {
			key, err := registry.OpenKey(root, uninstallRegSubKey, registry.QUERY_VALUE|view)
			if err != nil {
				continue
			}
			loc := readInstallDirFromKey(key)
			key.Close()
			if loc != "" && strings.EqualFold(filepath.Clean(loc), filepath.Clean(dir)) {
				return ModeNSIS
			}
		}
	}
	return ModePortable
}

func readInstallDirFromKey(key registry.Key) string {
	if loc, _, err := key.GetStringValue("InstallLocation"); err == nil {
		loc = strings.Trim(strings.TrimSpace(loc), `"`)
		if loc != "" {
			return loc
		}
	}
	for _, valueName := range []string{"UninstallString", "DisplayIcon"} {
		raw, _, err := key.GetStringValue(valueName)
		if err != nil {
			continue
		}
		cleaned := strings.Trim(strings.TrimSpace(raw), `"`)
		if cleaned != "" {
			return filepath.Dir(cleaned)
		}
	}
	return ""
}