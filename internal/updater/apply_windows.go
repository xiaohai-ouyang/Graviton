//go:build windows

package updater

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
)

// ApplyParams describes a detached update-install job launched after the app quits.
type ApplyParams struct {
	Mode           InstallMode
	CurrentPID     int
	ExePath        string
	InstallDir     string
	DownloadedFile string
	ScriptPath     string
	LogPath        string
}

// BuildApplyScript renders the PowerShell helper that waits for app exit, installs the
// update, and relaunches Graviton as the normal (non-elevated) user.
// NSIS quirk: /D=<dir> must be the LAST argument and must NOT be quoted, even with spaces.
func BuildApplyScript(p ApplyParams) string {
	q := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

	var install string
	switch p.Mode {
	case ModeNSIS:
		escapedInstallDir := strings.ReplaceAll(p.InstallDir, "'", "''")
		install = fmt.Sprintf(`
# NSIS 静默安装：/D= 必须是最后一个参数且不能加引号（即使路径含空格）
$installerArgs = '/S /D=%s'
$installOk = $false
try {
    $proc = Start-Process -FilePath %s -ArgumentList $installerArgs -Verb RunAs -Wait -PassThru
    $installOk = ($proc.ExitCode -eq 0)
    Write-Log ("installer exit code: " + $proc.ExitCode)
} catch {
    Write-Log ("installer launch failed (UAC cancelled?): " + $_.Exception.Message)
}
try {
    Start-Process -FilePath %s -ErrorAction Stop
    if ($installOk) { Write-Log "relaunched updated app" } else { Write-Log "install failed or cancelled; relaunched original app" }
} catch {
    Write-Log ("relaunch failed: " + $_.Exception.Message)
}
`, escapedInstallDir, q(p.DownloadedFile), q(p.ExePath))
	default: // portable
		exeBase := filepath.Base(p.ExePath)
		install = fmt.Sprintf(`
$bak = %s
$replaceOk = $false
try {
    if (Test-Path -LiteralPath $bak) { Remove-Item -LiteralPath $bak -Force }
    Rename-Item -LiteralPath %s -NewName %s -ErrorAction Stop
    try {
        Move-Item -LiteralPath %s -Destination %s -ErrorAction Stop
        $replaceOk = $true
    } catch {
        Write-Log ("replace failed: " + $_.Exception.Message)
        Rename-Item -LiteralPath $bak -NewName %s -ErrorAction Stop
        Write-Log "rolled back to original binary"
    }
} catch {
    Write-Log ("backup/rename failed: " + $_.Exception.Message)
}
try {
    Start-Process -FilePath %s -ErrorAction Stop
    if ($replaceOk) { Write-Log "relaunched updated portable app" } else { Write-Log "relaunched original portable app" }
} catch {
    Write-Log ("relaunch failed: " + $_.Exception.Message)
}
`, q(p.ExePath+".bak"), q(p.ExePath), q(exeBase+".bak"), q(p.DownloadedFile), q(p.ExePath), q(exeBase), q(p.ExePath))
	}

	return fmt.Sprintf(`$ErrorActionPreference = 'Continue'
$logPath = %s
function Write-Log([string]$msg) {
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $msg
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}
Write-Log "apply_update start (mode=%s, pid=%d)"
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id %d -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 300
}
%s
Write-Log "apply_update done"
`, q(p.LogPath), p.Mode, p.CurrentPID, p.CurrentPID, install)
}

// LaunchApplyHelper writes the helper script and starts it detached with normal user rights.
func LaunchApplyHelper(p ApplyParams) error {
	if p.Mode != ModeNSIS && p.Mode != ModePortable {
		return fmt.Errorf("当前运行形态不支持自动安装更新")
	}
	if err := os.MkdirAll(filepath.Dir(p.ScriptPath), 0755); err != nil {
		return fmt.Errorf("创建更新脚本目录失败: %w", err)
	}
	if err := os.WriteFile(p.ScriptPath, []byte(BuildApplyScript(p)), 0644); err != nil {
		return fmt.Errorf("写入更新脚本失败: %w", err)
	}

	cmd := exec.Command("powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", p.ScriptPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS,
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动更新辅助进程失败: %w", err)
	}
	return cmd.Process.Release()
}