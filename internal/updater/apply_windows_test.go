//go:build windows

package updater

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unsafe"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShellExecuteInfoStructSize(t *testing.T) {
	// Verify Windows SHELLEXECUTEINFOW struct layout matches native ABI on amd64 (112 bytes).
	if unsafe.Sizeof(uintptr(0)) == 8 {
		assert.Equal(t, uintptr(112), unsafe.Sizeof(shellExecuteInfoW{}))
	}
}

func TestBuildNSISInstallScript_CommandLineAndRollback(t *testing.T) {
	p := InstallParams{
		Mode:           ModeNSIS,
		ExePath:        `C:\Program Files\Graviton\Graviton\Graviton.exe`,
		InstallDir:     `C:\Program Files\Graviton\Graviton`,
		DownloadedFile: `C:\Users\u\AppData\Local\Graviton\updates\Graviton-v0.2.0-windows-amd64-installer.exe`,
		ScriptPath:     `C:\Users\u\AppData\Local\Graviton\updates\install_update.ps1`,
		LogPath:        `C:\Users\u\AppData\Local\Graviton\updates\apply_update.log`,
	}
	script := BuildNSISInstallScript(p)

	// /D= must be last and unquoted, even though the path contains spaces.
	assert.Contains(t, script, `$installerArgs = '/S /D=C:\Program Files\Graviton\Graviton'`)
	assert.NotContains(t, script, `/D="`)
	assert.NotContains(t, script, `/D='`)
	// Must rename running binary aside before running NSIS, and must NOT relaunch (app stays open).
	assert.Contains(t, script, `Rename-Item -LiteralPath $exePath`)
	assert.Contains(t, script, `MoveFileEx`)
	assert.Contains(t, script, `rolled back to original binary`)
	assert.NotContains(t, script, `-Verb RunAs`)
	assert.NotContains(t, script, `relaunched`)

	// InstallDir containing a single quote must escape it for PowerShell single-quoted string.
	pQuoted := p
	pQuoted.InstallDir = `C:\Users\O'Brien\Graviton`
	scriptQuoted := BuildNSISInstallScript(pQuoted)
	assert.Contains(t, scriptQuoted, `$installerArgs = '/S /D=C:\Users\O''Brien\Graviton'`)
}

func TestBuildRestartScript_WaitsAndRelaunchesNonElevated(t *testing.T) {
	p := RestartParams{
		CurrentPID: 4321,
		ExePath:    `C:\Program Files\Graviton\Graviton\Graviton.exe`,
		ScriptPath: `C:\Users\u\AppData\Local\Graviton\updates\restart_app.ps1`,
		LogPath:    `C:\Users\u\AppData\Local\Graviton\updates\apply_update.log`,
	}
	script := BuildRestartScript(p)

	assert.Contains(t, script, `Get-Process -Id 4321`)
	assert.Contains(t, script, `Start-Process -FilePath 'C:\Program Files\Graviton\Graviton\Graviton.exe'`)
	assert.NotContains(t, script, `-Verb RunAs`)
}

func TestInstallInPlace_PortableSucceeds(t *testing.T) {
	dir := t.TempDir()
	cacheDir := t.TempDir()
	exePath := filepath.Join(dir, "Graviton.exe")
	newPath := filepath.Join(cacheDir, "Graviton-v0.2.0-portable.exe")
	logPath := filepath.Join(cacheDir, "apply_update.log")
	require.NoError(t, os.WriteFile(exePath, []byte("OLD"), 0755))
	require.NoError(t, os.WriteFile(newPath, []byte("NEW"), 0755))
	// Stale .bak from a previous update must be cleaned first.
	require.NoError(t, os.WriteFile(exePath+".bak", []byte("STALE"), 0755))

	err := InstallInPlace(InstallParams{
		Mode:           ModePortable,
		ExePath:        exePath,
		InstallDir:     dir,
		DownloadedFile: newPath,
		LogPath:        logPath,
	})
	require.NoError(t, err)

	data, err := os.ReadFile(exePath)
	require.NoError(t, err)
	assert.Equal(t, "NEW", string(data))

	bak, err := os.ReadFile(exePath + ".bak")
	require.NoError(t, err)
	assert.Equal(t, "OLD", string(bak))

	assert.NoFileExists(t, exePath+".new")
	assert.NoFileExists(t, newPath)

	logData, err := os.ReadFile(logPath)
	require.NoError(t, err)
	assert.Contains(t, string(logData), "portable in-place install succeeded")
}

func TestInstallInPlace_PortableMissingSourcePreservesOriginal(t *testing.T) {
	dir := t.TempDir()
	exePath := filepath.Join(dir, "Graviton.exe")
	logPath := filepath.Join(dir, "apply_update.log")
	require.NoError(t, os.WriteFile(exePath, []byte("OLD"), 0755))

	err := InstallInPlace(InstallParams{
		Mode:           ModePortable,
		ExePath:        exePath,
		InstallDir:     dir,
		DownloadedFile: filepath.Join(dir, "missing.exe"),
		LogPath:        logPath,
	})
	require.Error(t, err)

	data, err := os.ReadFile(exePath)
	require.NoError(t, err)
	assert.Equal(t, "OLD", string(data))
	assert.NoFileExists(t, exePath+".new")
	assert.NoFileExists(t, exePath+".bak")
}

func TestInstallInPlace_PortableLockedBakUsesTimestampedFallback(t *testing.T) {
	dir := t.TempDir()
	exePath := filepath.Join(dir, "Graviton.exe")
	newPath := filepath.Join(dir, "new.exe")
	bakPath := exePath + ".bak"
	require.NoError(t, os.WriteFile(exePath, []byte("OLD"), 0755))
	require.NoError(t, os.WriteFile(newPath, []byte("NEW"), 0755))
	require.NoError(t, os.WriteFile(bakPath, []byte("LOCKED_OLD_BAK"), 0755))

	// Hold .bak open so os.Remove(bakPath) fails, forcing timestamped backup path.
	f, err := os.OpenFile(bakPath, os.O_RDONLY, 0)
	require.NoError(t, err)
	defer f.Close()

	err = InstallInPlace(InstallParams{
		Mode:           ModePortable,
		ExePath:        exePath,
		InstallDir:     dir,
		DownloadedFile: newPath,
		LogPath:        filepath.Join(dir, "apply_update.log"),
	})
	require.NoError(t, err)

	data, err := os.ReadFile(exePath)
	require.NoError(t, err)
	assert.Equal(t, "NEW", string(data))

	matches, err := filepath.Glob(exePath + ".bak.*")
	require.NoError(t, err)
	require.Len(t, matches, 1)
	bakData, err := os.ReadFile(matches[0])
	require.NoError(t, err)
	assert.Equal(t, "OLD", string(bakData))
}

func TestInstallInPlace_DevModeRejected(t *testing.T) {
	err := InstallInPlace(InstallParams{Mode: ModeDev})
	require.Error(t, err)
}

func TestLaunchRestartHelper_RunsScriptDetached(t *testing.T) {
	dir := t.TempDir()
	exePath := filepath.Join(dir, "Graviton.exe")
	logPath := filepath.Join(dir, "restart.log")
	require.NoError(t, os.WriteFile(exePath, []byte("not-a-pe"), 0755))

	require.NoError(t, LaunchRestartHelper(RestartParams{
		CurrentPID: 99999999,
		ExePath:    exePath,
		ScriptPath: filepath.Join(dir, "restart_app.ps1"),
		LogPath:    logPath,
	}))

	var logData []byte
	require.Eventually(t, func() bool {
		data, err := os.ReadFile(logPath)
		logData = data
		return err == nil && strings.Contains(string(data), "restart_app done")
	}, 15*time.Second, 50*time.Millisecond)
	assert.Contains(t, string(logData), "relaunch failed:")
}
