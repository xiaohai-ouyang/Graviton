//go:build windows

package updater

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildApplyScript_NSISCommandLine(t *testing.T) {
	p := ApplyParams{
		Mode:           ModeNSIS,
		CurrentPID:     4321,
		ExePath:        `C:\Program Files\Graviton\Graviton\Graviton.exe`,
		InstallDir:     `C:\Program Files\Graviton\Graviton`,
		DownloadedFile: `C:\Users\u\AppData\Local\Graviton\updates\Graviton-v0.2.0-windows-amd64-installer.exe`,
		ScriptPath:     `C:\Users\u\AppData\Local\Graviton\updates\apply_update.ps1`,
		LogPath:        `C:\Users\u\AppData\Local\Graviton\updates\apply_update.log`,
	}
	script := BuildApplyScript(p)

	// /D= must be last and unquoted, even though the path contains spaces.
	assert.Contains(t, script, `$installerArgs = '/S /D=C:\Program Files\Graviton\Graviton'`)
	assert.NotContains(t, script, `/D="`)
	assert.NotContains(t, script, `/D='`)
	assert.Contains(t, script, "-Verb RunAs -Wait -PassThru")
	// Relaunch stays non-elevated (plain Start-Process of the exe, no -Verb on it).
	assert.Contains(t, script, `Start-Process -FilePath 'C:\Program Files\Graviton\Graviton\Graviton.exe'`)
	assert.Contains(t, script, "Get-Process -Id 4321")

	// InstallDir containing a single quote must escape it for PowerShell single-quoted string.
	pQuoted := p
	pQuoted.InstallDir = `C:\Users\O'Brien\Graviton`
	scriptQuoted := BuildApplyScript(pQuoted)
	assert.Contains(t, scriptQuoted, `$installerArgs = '/S /D=C:\Users\O''Brien\Graviton'`)
}

func TestBuildApplyScript_PortableRollback(t *testing.T) {
	p := ApplyParams{
		Mode:           ModePortable,
		CurrentPID:     100,
		ExePath:        `C:\Apps\Graviton\Graviton.exe`,
		DownloadedFile: `C:\cache\new.exe`,
		ScriptPath:     `C:\cache\apply_update.ps1`,
		LogPath:        `C:\cache\apply_update.log`,
	}
	script := BuildApplyScript(p)
	assert.Contains(t, script, `$bak = 'C:\Apps\Graviton\Graviton.exe.bak'`)
	assert.Contains(t, script, `Rename-Item -LiteralPath 'C:\Apps\Graviton\Graviton.exe' -NewName 'Graviton.exe.bak'`)
	assert.Contains(t, script, `Move-Item -LiteralPath 'C:\cache\new.exe' -Destination 'C:\Apps\Graviton\Graviton.exe'`)
	assert.Contains(t, script, `Rename-Item -LiteralPath $bak -NewName 'Graviton.exe'`)
}

// runPowerShellScript executes the generated script for real and waits for completion.
func runPowerShellScript(t *testing.T, script string) string {
	t.Helper()
	dir := t.TempDir()
	scriptPath := filepath.Join(dir, "apply_update.ps1")
	require.NoError(t, os.WriteFile(scriptPath, []byte(script), 0644))
	cmd := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath)
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "script output: %s", string(out))
	return string(out)
}

func TestApplyScript_PortableReplaceSucceeds(t *testing.T) {
	dir := t.TempDir()
	exePath := filepath.Join(dir, "Graviton.exe")
	newPath := filepath.Join(dir, "new.exe")
	logPath := filepath.Join(dir, "apply.log")
	require.NoError(t, os.WriteFile(exePath, []byte("OLD"), 0755))
	require.NoError(t, os.WriteFile(newPath, []byte("NEW"), 0755))
	// A stale .bak from a previous update must be cleaned first.
	require.NoError(t, os.WriteFile(exePath+".bak", []byte("STALE"), 0755))

	p := ApplyParams{
		Mode:           ModePortable,
		CurrentPID:     99999999, // nonexistent PID: wait loop exits immediately
		ExePath:        exePath,
		DownloadedFile: newPath,
		ScriptPath:     filepath.Join(dir, "apply_update.ps1"),
		LogPath:        logPath,
	}
	// The script relaunches the exe; use a harmless script target so no real GUI spawns:
	// replace exe with a .cmd? Not possible (.exe extension). Instead point Start-Process at
	// the replaced binary — running a text "exe" fails harmlessly and the script continues.
	runPowerShellScript(t, BuildApplyScript(p))

	data, err := os.ReadFile(exePath)
	require.NoError(t, err)
	assert.Equal(t, "NEW", string(data))
	// On success the .bak holds the OLD binary (cleaned on next app start).
	bak, err := os.ReadFile(exePath + ".bak")
	require.NoError(t, err)
	assert.Equal(t, "OLD", string(bak))
	assert.NoFileExists(t, newPath)
	log, err := os.ReadFile(logPath)
	require.NoError(t, err)
	assert.Contains(t, string(log), "apply_update done")
}

func TestApplyScript_PortableLockedFileRollsBack(t *testing.T) {
	dir := t.TempDir()
	exePath := filepath.Join(dir, "Graviton.exe")
	newPath := filepath.Join(dir, "new.exe")
	require.NoError(t, os.WriteFile(exePath, []byte("OLD"), 0755))
	require.NoError(t, os.WriteFile(newPath, []byte("NEW"), 0755))

	// Hold the exe open without share-delete so Rename-Item fails.
	f, err := os.OpenFile(exePath, os.O_RDONLY, 0)
	require.NoError(t, err)
	defer f.Close()

	p := ApplyParams{
		Mode:           ModePortable,
		CurrentPID:     99999999,
		ExePath:        exePath,
		DownloadedFile: newPath,
		ScriptPath:     filepath.Join(dir, "apply_update.ps1"),
		LogPath:        filepath.Join(dir, "apply.log"),
	}
	start := time.Now()
	runPowerShellScript(t, BuildApplyScript(p))
	assert.Less(t, time.Since(start), 30*time.Second)

	data, err := os.ReadFile(exePath)
	require.NoError(t, err)
	assert.Equal(t, "OLD", string(data), "original binary must survive a locked-file failure")
	log, err := os.ReadFile(p.LogPath)
	require.NoError(t, err)
	assert.True(t, strings.Contains(string(log), "failed"), "log should record the failure: %s", log)
}

func TestApplyScript_PortableMoveFailureRollsBackBak(t *testing.T) {
	dir := t.TempDir()
	exePath := filepath.Join(dir, "Graviton.exe")
	require.NoError(t, os.WriteFile(exePath, []byte("OLD"), 0755))

	p := ApplyParams{
		Mode:           ModePortable,
		CurrentPID:     99999999,
		ExePath:        exePath,
		DownloadedFile: filepath.Join(dir, "missing-new.exe"),
		ScriptPath:     filepath.Join(dir, "apply_update.ps1"),
		LogPath:        filepath.Join(dir, "apply.log"),
	}
	runPowerShellScript(t, BuildApplyScript(p))

	data, err := os.ReadFile(exePath)
	require.NoError(t, err)
	assert.Equal(t, "OLD", string(data), "original binary must be restored from .bak when Move-Item fails")
	assert.NoFileExists(t, exePath+".bak")
	log, err := os.ReadFile(p.LogPath)
	require.NoError(t, err)
	assert.Contains(t, string(log), "rolled back to original binary")
}