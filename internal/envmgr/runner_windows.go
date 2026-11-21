//go:build windows

package envmgr

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
)

func buildShellCommand(dir, commandLine string) *exec.Cmd {
	// Set UTF-8 codepage so bun/node/go/wails output renders cleanly
	fullCmd := "chcp 65001 >nul && " + commandLine
	cmd := exec.Command("cmd.exe", "/C", fullCmd)
	cmd.Dir = dir
	cmd.Env = withUTF8ProcessEnv(os.Environ())
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
	}
	return cmd
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

// OpenInExternalTerminal opens Windows Terminal (or PowerShell fallback) at dir, optionally running commandLine.
func OpenInExternalTerminal(dir, commandLine string) error {
	psCmd := "Set-Location -LiteralPath '" + strings.ReplaceAll(dir, "'", "''") + "'"
	if strings.TrimSpace(commandLine) != "" {
		psCmd += "; " + commandLine
	}

	if wtPath, err := exec.LookPath("wt.exe"); err == nil && wtPath != "" {
		c := exec.Command(wtPath, "-d", dir, "powershell.exe", "-NoExit", "-Command", psCmd)
		return c.Start()
	}

	c := exec.Command("cmd.exe", "/C", "start", "powershell.exe", "-NoExit", "-Command", psCmd)
	c.Dir = dir
	c.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
	}
	return c.Start()
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
