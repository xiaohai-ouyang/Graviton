package envmgr

import (
	"errors"
	"strings"

	"graviton/internal/storage"
)

// Supported execution shells for project commands.
const (
	ShellDefault    = ""
	ShellPowerShell = "powershell"
	ShellGitBash    = "gitbash"
	ShellCMD        = "cmd"
)

// ShellConfig persists global shell preferences in settings.toml.
type ShellConfig struct {
	DefaultShell string `json:"defaultShell"`
	GitBashPath  string `json:"gitBashPath"`
}

// ShellAvailability describes the availability and resolved path of a shell runtime.
type ShellAvailability struct {
	Shell     string `json:"shell"`
	Label     string `json:"label"`
	Available bool   `json:"available"`
	Path      string `json:"path"`
	Detail    string `json:"detail"`
}

// ShellEnvironmentInfo bundles saved shell settings and detected runtimes for the UI.
type ShellEnvironmentInfo struct {
	Config ShellConfig         `json:"config"`
	Shells []ShellAvailability `json:"shells"`
}

// NormalizeShellOverride canonicalizes an explicit per-command shell override.
// Empty string (or "default"/"auto") means "follow global default".
func NormalizeShellOverride(shell string) string {
	switch strings.ToLower(strings.TrimSpace(shell)) {
	case "", "default", "auto":
		return ShellDefault
	case "powershell", "pwsh", "pwsh.exe", "ps", "powershell.exe":
		return ShellPowerShell
	case "gitbash", "git-bash", "git_bash", "git bash", "bash", "bash.exe", "sh":
		return ShellGitBash
	case "cmd", "cmd.exe", "bat":
		return ShellCMD
	default:
		return ShellDefault
	}
}

// NormalizeDefaultShell canonicalizes the global default shell, defaulting to PowerShell.
func NormalizeDefaultShell(shell string) string {
	if s := NormalizeShellOverride(shell); s != ShellDefault {
		return s
	}
	return ShellPowerShell
}

// ResolveEffectiveShell returns the command's explicit override or falls back to defaultShell.
func ResolveEffectiveShell(cmdShell, defaultShell string) string {
	if override := NormalizeShellOverride(cmdShell); override != ShellDefault {
		return override
	}
	return NormalizeDefaultShell(defaultShell)
}

// NormalizeShell canonicalizes a single shell string, defaulting empty values to PowerShell.
func NormalizeShell(shell string) string {
	return ResolveEffectiveShell(shell, ShellPowerShell)
}

// LoadShellConfig reads global shell settings from settings.toml.
func LoadShellConfig(sm *storage.StorageManager) ShellConfig {
	cfg := ShellConfig{
		DefaultShell: ShellPowerShell,
	}
	if sm != nil {
		if sf, _, err := sm.LoadSettings(); err == nil {
			cfg.DefaultShell = NormalizeDefaultShell(sf.DefaultShell)
			cfg.GitBashPath = strings.TrimSpace(sf.GitBashPath)
		}
	}
	return cfg
}

// SaveShellConfig persists global shell settings to settings.toml.
func SaveShellConfig(sm *storage.StorageManager, cfg ShellConfig) error {
	if sm == nil {
		return errors.New("storage manager not initialized")
	}
	sf, _, err := sm.LoadSettings()
	if err != nil {
		return err
	}
	sf.DefaultShell = NormalizeDefaultShell(cfg.DefaultShell)
	sf.GitBashPath = strings.TrimSpace(cfg.GitBashPath)
	return sm.SaveSettings(sf)
}

// GetShellEnvironment returns the current shell config together with detected runtimes.
func GetShellEnvironment(sm *storage.StorageManager) ShellEnvironmentInfo {
	cfg := LoadShellConfig(sm)
	return ShellEnvironmentInfo{
		Config: cfg,
		Shells: DetectShells(cfg.GitBashPath),
	}
}
