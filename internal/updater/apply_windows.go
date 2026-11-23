//go:build windows

package updater

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ErrInstallCancelled indicates the user declined the Windows UAC elevation prompt.
var ErrInstallCancelled = errors.New("已取消管理员授权，未安装更新")

// InstallParams describes an in-place update installation executed while the app stays running.
type InstallParams struct {
	Mode           InstallMode
	ExePath        string
	InstallDir     string
	DownloadedFile string
	ScriptPath     string
	LogPath        string
}

// RestartParams describes a detached restart helper launched right before the app exits.
type RestartParams struct {
	CurrentPID int
	ExePath    string
	ScriptPath string
	LogPath    string
}

var (
	shell32DLL         = windows.NewLazySystemDLL("shell32.dll")
	procShellExecuteEx = shell32DLL.NewProc("ShellExecuteExW")
)

const (
	seeMaskNoCloseProcess = 0x00000040
	seeMaskNoAsync        = 0x00000100
	installWaitTimeoutMs  = 5 * 60 * 1000
)

type shellExecuteInfoW struct {
	cbSize         uint32
	fMask          uint32
	hwnd           uintptr
	lpVerb         *uint16
	lpFile         *uint16
	lpParameters   *uint16
	lpDirectory    *uint16
	nShow          int32
	hInstApp       uintptr
	lpIDList       uintptr
	lpClass        *uint16
	hkeyClass      uintptr
	dwHotKey       uint32
	hIconOrMonitor uintptr
	hProcess       windows.Handle
}

func psQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func appendUpdateLog(logPath, msg string) {
	if logPath == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(logPath), 0755)
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	line := fmt.Sprintf("%s %s\n", time.Now().Format("2006-01-02 15:04:05"), msg)
	_, _ = f.WriteString(line)
}

func writeUTF8BOMFile(path, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	bom := []byte{0xEF, 0xBB, 0xBF}
	data := append(bom, []byte(content)...)
	return os.WriteFile(path, data, 0644)
}

// InstallInPlace installs a verified update while Graviton continues running.
// Portable mode replaces the binary directly (renaming the running exe to .bak first);
// NSIS mode runs an elevated PowerShell helper synchronously and waits for its exit code.
func InstallInPlace(p InstallParams) error {
	switch p.Mode {
	case ModePortable:
		return installPortableInPlace(p)
	case ModeNSIS:
		return installNSISInPlace(p)
	default:
		return fmt.Errorf("当前运行形态不支持自动安装更新")
	}
}

func installPortableInPlace(p InstallParams) error {
	if p.ExePath == "" || p.DownloadedFile == "" {
		return fmt.Errorf("更新安装参数不完整")
	}
	appendUpdateLog(p.LogPath, fmt.Sprintf("portable in-place install start (exe=%s)", p.ExePath))

	stagedPath := p.ExePath + ".new"
	if err := copyFileSynced(p.DownloadedFile, stagedPath); err != nil {
		_ = os.Remove(stagedPath)
		appendUpdateLog(p.LogPath, "stage copy failed: "+err.Error())
		return fmt.Errorf("写入新版本程序失败（请检查程序目录写权限）: %w", err)
	}

	bakPath := p.ExePath + ".bak"
	if _, err := os.Stat(bakPath); err == nil {
		if rmErr := os.Remove(bakPath); rmErr != nil {
			bakPath = fmt.Sprintf("%s.bak.%d", p.ExePath, time.Now().UnixNano())
		}
	}

	if err := os.Rename(p.ExePath, bakPath); err != nil {
		_ = os.Remove(stagedPath)
		appendUpdateLog(p.LogPath, "rename running exe failed: "+err.Error())
		return fmt.Errorf("备份当前程序失败（请检查目录权限或安全软件拦截）: %w", err)
	}

	if err := os.Rename(stagedPath, p.ExePath); err != nil {
		appendUpdateLog(p.LogPath, "replace exe failed: "+err.Error())
		if rbErr := os.Rename(bakPath, p.ExePath); rbErr != nil {
			appendUpdateLog(p.LogPath, "rollback failed: "+rbErr.Error())
		} else {
			appendUpdateLog(p.LogPath, "rolled back to original binary")
		}
		_ = os.Remove(stagedPath)
		return fmt.Errorf("替换新版本程序失败，已自动回滚: %w", err)
	}

	_ = os.Remove(p.DownloadedFile)
	appendUpdateLog(p.LogPath, "portable in-place install succeeded")
	return nil
}

func copyFileSynced(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// BuildNSISInstallScript renders the elevated PowerShell helper that moves the running
// executable aside, runs the NSIS installer silently into InstallDir, and rolls back on failure.
// NSIS quirk: /D=<dir> must be the LAST argument and must NOT be quoted, even with spaces.
func BuildNSISInstallScript(p InstallParams) string {
	installDir := p.InstallDir
	if installDir == "" && p.ExePath != "" {
		installDir = filepath.Dir(p.ExePath)
	}
	escapedInstallDir := strings.ReplaceAll(installDir, "'", "''")

	return fmt.Sprintf(`$ErrorActionPreference = 'Continue'
$logPath = %s
function Write-Log([string]$msg) {
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $msg
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}
Write-Log "nsis in-place install start"
$exePath = %s
$exeBase = Split-Path -Leaf $exePath
$bak = $exePath + '.bak'
$renamed = $false
$exitCode = 1
try {
    if (Test-Path -LiteralPath $bak) {
        try {
            Remove-Item -LiteralPath $bak -Force -ErrorAction Stop
        } catch {
            $bak = $exePath + '.bak.' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        }
    }
    if (Test-Path -LiteralPath $exePath) {
        Rename-Item -LiteralPath $exePath -NewName (Split-Path -Leaf $bak) -ErrorAction Stop
        $renamed = $true
        Write-Log ("renamed running exe to " + (Split-Path -Leaf $bak))
    }
    # NSIS 静默安装：/D= 必须是最后一个参数且不能加引号（即使路径含空格）
    $installerArgs = '/S /D=%s'
    $proc = Start-Process -FilePath %s -ArgumentList $installerArgs -Wait -PassThru -ErrorAction Stop
    $exitCode = $proc.ExitCode
    Write-Log ("installer exit code: " + $exitCode)
    if ($exitCode -eq 0 -and (Test-Path -LiteralPath $exePath)) {
        if ($renamed -and (Test-Path -LiteralPath $bak)) {
            try {
                Remove-Item -LiteralPath $bak -Force -ErrorAction Stop
            } catch {
                try {
                    $sig = '[DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool MoveFileEx(string lpExistingFileName, string lpNewFileName, int dwFlags);'
                    $k32 = Add-Type -MemberDefinition $sig -Name 'GravitonMoveFileEx' -Namespace 'Win32' -PassThru
                    [void]$k32::MoveFileEx($bak, $null, 4)
                    Write-Log "scheduled backup cleanup on reboot"
                } catch {
                    Write-Log ("schedule reboot cleanup failed: " + $_.Exception.Message)
                }
            }
        }
        Remove-Item -LiteralPath %s -Force -ErrorAction SilentlyContinue
        Write-Log "nsis in-place install succeeded"
        exit 0
    }
    if ($exitCode -eq 0) {
        $exitCode = 2
        Write-Log "installer exited 0 but target executable is missing"
    }
} catch {
    Write-Log ("nsis in-place install error: " + $_.Exception.Message)
    if ($exitCode -eq 0) { $exitCode = 1 }
}
if ($renamed -and (Test-Path -LiteralPath $bak) -and -not (Test-Path -LiteralPath $exePath)) {
    try {
        Rename-Item -LiteralPath $bak -NewName $exeBase -ErrorAction Stop
        Write-Log "rolled back to original binary"
    } catch {
        Write-Log ("rollback failed: " + $_.Exception.Message)
    }
}
exit $exitCode
`, psQuote(p.LogPath), psQuote(p.ExePath), escapedInstallDir, psQuote(p.DownloadedFile), psQuote(p.DownloadedFile))
}

func installNSISInPlace(p InstallParams) error {
	if p.ExePath == "" || p.DownloadedFile == "" || p.ScriptPath == "" {
		return fmt.Errorf("更新安装参数不完整")
	}
	if err := writeUTF8BOMFile(p.ScriptPath, BuildNSISInstallScript(p)); err != nil {
		return fmt.Errorf("写入安装脚本失败: %w", err)
	}
	defer func() {
		_ = os.Remove(p.ScriptPath)
	}()
	return runElevatedPowerShellScript(p.ScriptPath)
}

func runElevatedPowerShellScript(scriptPath string) error {
	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString("powershell.exe")
	if err != nil {
		return err
	}
	paramsStr := fmt.Sprintf(`-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%s"`, scriptPath)
	params, err := windows.UTF16PtrFromString(paramsStr)
	if err != nil {
		return err
	}

	sei := shellExecuteInfoW{
		cbSize:       uint32(unsafe.Sizeof(shellExecuteInfoW{})),
		fMask:        seeMaskNoCloseProcess | seeMaskNoAsync,
		lpVerb:       verb,
		lpFile:       file,
		lpParameters: params,
		nShow:        windows.SW_HIDE,
	}

	r1, _, callErr := procShellExecuteEx.Call(uintptr(unsafe.Pointer(&sei)))
	if r1 == 0 {
		if errors.Is(callErr, windows.ERROR_CANCELLED) {
			return ErrInstallCancelled
		}
		return fmt.Errorf("启动管理员安装进程失败: %w", callErr)
	}
	if sei.hProcess == 0 {
		return fmt.Errorf("未能获取安装进程句柄")
	}
	defer windows.CloseHandle(sei.hProcess)

	waitRes, err := windows.WaitForSingleObject(sei.hProcess, installWaitTimeoutMs)
	if err != nil {
		return fmt.Errorf("等待安装完成失败: %w", err)
	}
	if waitRes == uint32(windows.WAIT_TIMEOUT) {
		return fmt.Errorf("等待安装完成超时，请检查安装程序状态或查看更新日志")
	}

	var exitCode uint32
	if err := windows.GetExitCodeProcess(sei.hProcess, &exitCode); err != nil {
		return fmt.Errorf("读取安装退出码失败: %w", err)
	}
	if exitCode != 0 {
		return fmt.Errorf("安装更新失败（退出码 %d），原版本已保留，详情请查看更新日志", exitCode)
	}
	return nil
}

// BuildRestartScript renders the non-elevated PowerShell helper that waits for the
// current process to exit (releasing SingleInstanceLock) and immediately relaunches Graviton.
func BuildRestartScript(p RestartParams) string {
	return fmt.Sprintf(`$ErrorActionPreference = 'Continue'
$logPath = %s
function Write-Log([string]$msg) {
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $msg
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}
Write-Log "restart_app start (pid=%d)"
$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Id %d -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 150
}
try {
    Start-Process -FilePath %s -ErrorAction Stop
    Write-Log "relaunched updated app"
} catch {
    Write-Log ("relaunch failed: " + $_.Exception.Message)
}
Write-Log "restart_app done"
`, psQuote(p.LogPath), p.CurrentPID, p.CurrentPID, psQuote(p.ExePath))
}

// LaunchRestartHelper writes the restart script and starts it detached with normal user rights.
func LaunchRestartHelper(p RestartParams) error {
	if p.ExePath == "" || p.ScriptPath == "" {
		return fmt.Errorf("重启参数不完整")
	}
	if err := writeUTF8BOMFile(p.ScriptPath, BuildRestartScript(p)); err != nil {
		return fmt.Errorf("写入重启脚本失败: %w", err)
	}

	cmd := exec.Command("powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", p.ScriptPath)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.DETACHED_PROCESS,
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动重启辅助进程失败: %w", err)
	}
	return cmd.Process.Release()
}
