//go:build windows

package envmgr

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

func resolveComSpec() string {
	if v := strings.TrimSpace(os.Getenv("ComSpec")); v != "" {
		return v
	}
	return "cmd.exe"
}

func resolvePowerShellInfo() (string, string, bool) {
	if pwsh, err := exec.LookPath("pwsh.exe"); err == nil && pwsh != "" {
		return filepath.Clean(pwsh), "PowerShell 7 (pwsh)", true
	}
	if ps, err := exec.LookPath("powershell.exe"); err == nil && ps != "" {
		return filepath.Clean(ps), "Windows PowerShell 5.1", true
	}
	if sysRoot := strings.TrimSpace(os.Getenv("SystemRoot")); sysRoot != "" {
		cand := filepath.Join(sysRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
		if fileExists(cand) {
			return filepath.Clean(cand), "Windows PowerShell 5.1", true
		}
	}
	return "", "未检测到 PowerShell", false
}

func resolvePowerShellExe() string {
	if p, _, ok := resolvePowerShellInfo(); ok && p != "" {
		return p
	}
	return "powershell.exe"
}

func isWSLBashPath(p string) bool {
	trimmed := strings.TrimSpace(p)
	if trimmed == "" {
		return false
	}
	cleaned := strings.ToLower(filepath.Clean(trimmed))

	sysRoot := strings.TrimSpace(os.Getenv("SystemRoot"))
	if sysRoot == "" {
		sysRoot = strings.TrimSpace(os.Getenv("WINDIR"))
	}
	if sysRoot != "" {
		rootLower := filepath.Clean(sysRoot)
		if cleaned == strings.ToLower(filepath.Join(rootLower, "System32", "bash.exe")) ||
			cleaned == strings.ToLower(filepath.Join(rootLower, "SysWOW64", "bash.exe")) {
			return true
		}
	}

	if localAppData := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); localAppData != "" {
		winApps := strings.ToLower(filepath.Join(filepath.Clean(localAppData), "Microsoft", "WindowsApps", "bash.exe"))
		if cleaned == winApps {
			return true
		}
	}

	return strings.HasSuffix(cleaned, `\system32\bash.exe`) ||
		strings.HasSuffix(cleaned, `\syswow64\bash.exe`) ||
		strings.HasSuffix(cleaned, `\windowsapps\bash.exe`)
}

func findBashInGitInstallDir(baseDir string) string {
	base := strings.TrimSpace(baseDir)
	if base == "" {
		return ""
	}
	for _, rel := range []string{
		filepath.Join("bin", "bash.exe"),
		filepath.Join("usr", "bin", "bash.exe"),
	} {
		cand := filepath.Join(base, rel)
		if fileExists(cand) && !isWSLBashPath(cand) {
			return filepath.Clean(cand)
		}
	}
	return ""
}

func readGitInstallPathFromRegistry() string {
	queries := []struct {
		root registry.Key
		path string
	}{
		{registry.LOCAL_MACHINE, `SOFTWARE\GitForWindows`},
		{registry.CURRENT_USER, `SOFTWARE\GitForWindows`},
		{registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\GitForWindows`},
	}
	for _, q := range queries {
		k, err := registry.OpenKey(q.root, q.path, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		installPath, _, valErr := k.GetStringValue("InstallPath")
		_ = k.Close()
		if valErr == nil && strings.TrimSpace(installPath) != "" {
			if found := findBashInGitInstallDir(installPath); found != "" {
				return found
			}
		}
	}
	return ""
}

// ResolveGitBashExe resolves Git Bash (bash.exe) via customPath or automatic host probing
// (excluding WSL System32/WindowsApps bash.exe stubs).
func ResolveGitBashExe(customPath string) (string, string, bool) {
	if trimmed := strings.TrimSpace(customPath); trimmed != "" {
		cleaned := filepath.Clean(trimmed)
		if fileExists(cleaned) {
			return cleaned, "手动指定", true
		}
		return "", "指定的路径不存在", false
	}

	// 1. Derive from git.exe on PATH (Git\cmd\git.exe -> Git\bin\bash.exe)
	if gitExe, err := exec.LookPath("git.exe"); err == nil && gitExe != "" {
		gitDir := filepath.Dir(gitExe)
		candidates := []string{
			filepath.Join(gitDir, "..", "bin", "bash.exe"),
			filepath.Join(gitDir, "..", "usr", "bin", "bash.exe"),
			filepath.Join(gitDir, "..", "..", "bin", "bash.exe"),
			filepath.Join(gitDir, "..", "..", "usr", "bin", "bash.exe"),
		}
		for _, cand := range candidates {
			if fileExists(cand) && !isWSLBashPath(cand) {
				return filepath.Clean(cand), "自动探测", true
			}
		}
	}

	// 2. Registry InstallPath (Git for Windows)
	if regPath := readGitInstallPathFromRegistry(); regPath != "" {
		return regPath, "自动探测", true
	}

	// 3. Common installation directories
	var installDirs []string
	if pf := strings.TrimSpace(os.Getenv("ProgramFiles")); pf != "" {
		installDirs = append(installDirs, filepath.Join(pf, "Git"))
	}
	if pf86 := strings.TrimSpace(os.Getenv("ProgramFiles(x86)")); pf86 != "" {
		installDirs = append(installDirs, filepath.Join(pf86, "Git"))
	}
	if lad := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); lad != "" {
		installDirs = append(installDirs, filepath.Join(lad, "Programs", "Git"))
	}
	if up := strings.TrimSpace(os.Getenv("USERPROFILE")); up != "" {
		installDirs = append(installDirs, filepath.Join(up, "scoop", "apps", "git", "current"))
	}
	installDirs = append(installDirs,
		`C:\ProgramData\scoop\apps\git\current`,
		`C:\Git`,
	)
	for _, dir := range installDirs {
		if found := findBashInGitInstallDir(dir); found != "" {
			return found, "自动探测", true
		}
	}

	// 4. Scan PATH manually so WSL's System32\bash.exe / WindowsApps\bash.exe can be skipped
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		trimmedDir := strings.TrimSpace(dir)
		if trimmedDir == "" {
			continue
		}
		cand := filepath.Join(trimmedDir, "bash.exe")
		if fileExists(cand) && !isWSLBashPath(cand) {
			return filepath.Clean(cand), "自动探测", true
		}
	}

	return "", "未检测到 Git Bash", false
}

// DetectShells inspects the availability of supported Windows shells.
func DetectShells(customGitBashPath string) []ShellAvailability {
	psPath, psDetail, psOK := resolvePowerShellInfo()
	bashPath, bashDetail, bashOK := ResolveGitBashExe(customGitBashPath)

	comspec := resolveComSpec()
	cmdPath := comspec
	if looked, err := exec.LookPath(comspec); err == nil && looked != "" {
		cmdPath = filepath.Clean(looked)
	}
	cmdOK := cmdPath != "" && (fileExists(cmdPath) || strings.EqualFold(filepath.Base(cmdPath), "cmd.exe"))

	return []ShellAvailability{
		{
			Shell:     ShellPowerShell,
			Label:     "PowerShell",
			Available: psOK,
			Path:      psPath,
			Detail:    psDetail,
		},
		{
			Shell:     ShellGitBash,
			Label:     "Git Bash",
			Available: bashOK,
			Path:      bashPath,
			Detail:    bashDetail,
		},
		{
			Shell:     ShellCMD,
			Label:     "CMD",
			Available: cmdOK,
			Path:      cmdPath,
			Detail:    "Windows 命令提示符",
		},
	}
}
