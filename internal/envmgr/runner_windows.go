//go:build windows

package envmgr

import (
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"unicode/utf16"
)

const createNewConsole = 0x00000010

func quoteExePath(p string) string {
	trimmed := strings.Trim(strings.TrimSpace(p), `"`)
	return `"` + trimmed + `"`
}

// buildCmdExeVerbatimLine builds a raw Windows command line for cmd.exe /S /C or /S /K.
// With /S and an outer pair of quotes around fullCmd, cmd.exe strips ONLY the first and
// last quote and preserves all inner quotes verbatim without backslash-escaping them.
func buildCmdExeVerbatimLine(comspec, flag, fullCmd string) string {
	return quoteExePath(comspec) + " /S " + flag + ` "` + fullCmd + `"`
}

func isMultilineCommand(s string) bool {
	return strings.Contains(s, "\n")
}

func writeTempCmdScript(commandLine string) (string, error) {
	f, err := os.CreateTemp("", "graviton-cmd-*.cmd")
	if err != nil {
		return "", err
	}
	path := f.Name()

	crlfBody := strings.ReplaceAll(NormalizeCommandText(commandLine), "\n", "\r\n")
	// cmd.exe rejects UTF-8 BOM on line 1, so keep the preamble pure ASCII and switch to UTF-8 codepage.
	content := "@echo off\r\nchcp 65001 >nul\r\n" + crlfBody + "\r\n"
	if _, err := f.WriteString(content); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return "", err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return path, nil
}

func writeTempPowerShellScript(commandLine string) (string, error) {
	f, err := os.CreateTemp("", "graviton-ps-*.ps1")
	if err != nil {
		return "", err
	}
	path := f.Name()

	crlfBody := strings.ReplaceAll(NormalizeCommandText(commandLine), "\n", "\r\n")
	lines := []string{
		"$ProgressPreference = 'SilentlyContinue'",
		"[Console]::InputEncoding = [Console]::OutputEncoding = $OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
		"$global:LASTEXITCODE = 0",
		crlfBody,
		"if (-not $?) { if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }",
		"if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
	}
	// Prepend UTF-8 BOM so Windows PowerShell 5.1 parses UTF-8 scripts reliably.
	payload := "\xef\xbb\xbf" + strings.Join(lines, "\r\n") + "\r\n"
	if _, err := f.WriteString(payload); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return "", err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return path, nil
}

func writeTempBashScript(commandLine string) (string, error) {
	f, err := os.CreateTemp("", "graviton-sh-*.sh")
	if err != nil {
		return "", err
	}
	path := f.Name()

	// Bash rejects UTF-8 BOM and CR line endings; write pure UTF-8 with LF endings.
	payload := NormalizeCommandText(commandLine) + "\n"
	if _, err := f.WriteString(payload); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return "", err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(path)
		return "", err
	}
	return path, nil
}

func encodePowerShellCommand(script string) string {
	utf16Units := utf16.Encode([]rune(script))
	raw := make([]byte, len(utf16Units)*2)
	for i, u := range utf16Units {
		binary.LittleEndian.PutUint16(raw[i*2:], u)
	}
	return base64.StdEncoding.EncodeToString(raw)
}

func gitBashNotFoundError(customPath string) error {
	if trimmed := strings.TrimSpace(customPath); trimmed != "" {
		return fmt.Errorf("指定的 Git Bash 路径无效 (%s)，请在「设置」页检查", trimmed)
	}
	return errors.New("未找到 Git Bash (bash.exe)，请安装 Git for Windows 或在「设置」页手动指定路径")
}

func buildShellCommand(dir, commandLine, resolvedShell string, shellCfg ShellConfig, extraEnv ...string) (*exec.Cmd, func(), error) {
	procEnv := mergeExtraEnv(withUTF8ProcessEnv(os.Environ()), extraEnv)

	switch resolvedShell {
	case ShellPowerShell:
		scriptPath, err := writeTempPowerShellScript(commandLine)
		if err != nil {
			return nil, nil, err
		}
		psExe := resolvePowerShellExe()
		cmd := exec.Command(
			psExe,
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy", "Bypass",
			"-File", scriptPath,
		)
		cmd.Dir = dir
		cmd.Env = procEnv
		cmd.SysProcAttr = &syscall.SysProcAttr{
			HideWindow: true,
		}
		cleanup := func() { _ = os.Remove(scriptPath) }
		return cmd, cleanup, nil

	case ShellGitBash:
		bashExe, _, ok := ResolveGitBashExe(shellCfg.GitBashPath)
		if !ok {
			return nil, nil, gitBashNotFoundError(shellCfg.GitBashPath)
		}
		scriptPath, err := writeTempBashScript(commandLine)
		if err != nil {
			return nil, nil, err
		}
		// Run non-login mode so startup matches PowerShell's -NoProfile and preserves cmd.Dir & PATH.
		cmd := exec.Command(bashExe, scriptPath)
		cmd.Dir = dir
		cmd.Env = procEnv
		cmd.SysProcAttr = &syscall.SysProcAttr{
			HideWindow: true,
		}
		cleanup := func() { _ = os.Remove(scriptPath) }
		return cmd, cleanup, nil

	default:
		comspec := resolveComSpec()
		if isMultilineCommand(commandLine) {
			scriptPath, err := writeTempCmdScript(commandLine)
			if err != nil {
				return nil, nil, err
			}
			cmd := exec.Command(comspec)
			cmd.Dir = dir
			cmd.Env = procEnv
			cmd.SysProcAttr = &syscall.SysProcAttr{
				HideWindow: true,
				CmdLine:    buildCmdExeVerbatimLine(comspec, "/C", `"`+scriptPath+`"`),
			}
			cleanup := func() { _ = os.Remove(scriptPath) }
			return cmd, cleanup, nil
		}

		// Set UTF-8 codepage so bun/node/go/wails output renders cleanly.
		fullCmd := "chcp 65001 >nul && " + commandLine
		cmd := exec.Command(comspec)
		cmd.Dir = dir
		cmd.Env = procEnv
		cmd.SysProcAttr = &syscall.SysProcAttr{
			HideWindow: true,
			CmdLine:    buildCmdExeVerbatimLine(comspec, "/C", fullCmd),
		}
		return cmd, func() {}, nil
	}
}

func killProcessTree(pid int) error {
	if pid <= 0 {
		return nil
	}
	killCmd := exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", pid))
	killCmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
	}
	return killCmd.Run()
}

// OpenInExternalTerminal opens Windows Terminal (or a standalone console window) at dir,
// optionally running commandLine in the resolved shell.
func OpenInExternalTerminal(dir, commandLine, shell string, shellCfg ShellConfig) error {
	commandLine = NormalizeCommandText(commandLine)
	resolvedShell := ResolveEffectiveShell(shell, shellCfg.DefaultShell)
	wtPath, wtErr := exec.LookPath("wt.exe")
	hasWT := wtErr == nil && wtPath != ""

	switch resolvedShell {
	case ShellPowerShell:
		psScript := "Set-Location -LiteralPath '" + strings.ReplaceAll(dir, "'", "''") + "'"
		if commandLine != "" {
			psScript += "\r\n" + strings.ReplaceAll(commandLine, "\n", "\r\n")
		}
		encoded := encodePowerShellCommand(psScript)
		psExe := resolvePowerShellExe()

		if hasWT {
			c := exec.Command(wtPath, "-d", dir, psExe, "-NoExit", "-EncodedCommand", encoded)
			return c.Start()
		}

		c := exec.Command(psExe, "-NoExit", "-EncodedCommand", encoded)
		c.Dir = dir
		c.SysProcAttr = &syscall.SysProcAttr{
			CreationFlags: createNewConsole,
		}
		return c.Start()

	case ShellGitBash:
		bashExe, _, ok := ResolveGitBashExe(shellCfg.GitBashPath)
		if !ok {
			return gitBashNotFoundError(shellCfg.GitBashPath)
		}
		if commandLine == "" {
			if hasWT {
				return exec.Command(wtPath, "-d", dir, bashExe).Start()
			}
			c := exec.Command(bashExe)
			c.Dir = dir
			c.SysProcAttr = &syscall.SysProcAttr{
				CreationFlags: createNewConsole,
			}
			return c.Start()
		}

		scriptPath, err := writeTempBashScript(commandLine)
		if err != nil {
			return err
		}
		// Avoid semicolons because Windows Terminal (wt.exe) treats ';' as a subcommand separator.
		launchInline := `("$BASH" "$1" || true) && rm -f "$1" && exec "$BASH"`
		if hasWT {
			c := exec.Command(wtPath, "-d", dir, bashExe, "-c", launchInline, "_", scriptPath)
			return c.Start()
		}
		c := exec.Command(bashExe, "-c", launchInline, "_", scriptPath)
		c.Dir = dir
		c.SysProcAttr = &syscall.SysProcAttr{
			CreationFlags: createNewConsole,
		}
		return c.Start()

	default:
		comspec := resolveComSpec()
		if commandLine == "" {
			if hasWT {
				return exec.Command(wtPath, "-d", dir, comspec).Start()
			}
			c := exec.Command(comspec)
			c.Dir = dir
			c.SysProcAttr = &syscall.SysProcAttr{
				CreationFlags: createNewConsole,
			}
			return c.Start()
		}

		if hasWT || isMultilineCommand(commandLine) {
			scriptPath, err := writeTempCmdScript(commandLine)
			if err != nil {
				return err
			}
			if hasWT {
				c := exec.Command(wtPath, "-d", dir, comspec, "/K", scriptPath)
				return c.Start()
			}
			c := exec.Command(comspec)
			c.Dir = dir
			c.SysProcAttr = &syscall.SysProcAttr{
				CreationFlags: createNewConsole,
				CmdLine:       buildCmdExeVerbatimLine(comspec, "/K", `"`+scriptPath+`"`),
			}
			return c.Start()
		}

		c := exec.Command(comspec)
		c.Dir = dir
		c.SysProcAttr = &syscall.SysProcAttr{
			CreationFlags: createNewConsole,
			CmdLine:       buildCmdExeVerbatimLine(comspec, "/K", "chcp 65001 >nul && "+commandLine),
		}
		return c.Start()
	}
}

// OpenFolder opens the directory in Windows Explorer.
func OpenFolder(dir string) error {
	return exec.Command("explorer.exe", dir).Start()
}

// OpenInClient launches the configured or detected Antigravity/IDE executable with the project directory.
func OpenInClient(exePath, projectDir string) error {
	if strings.TrimSpace(exePath) == "" {
		return fmt.Errorf("未找到客户端可执行文件路径，请在「设置」页指定")
	}
	c := exec.Command(exePath, projectDir)
	return c.Start()
}
