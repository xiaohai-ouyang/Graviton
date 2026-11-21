//go:build windows

package envmgr

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func runManagedCommandForTest(t *testing.T, dir, commandLine, shell string, shellCfg ShellConfig) (ProcessState, []LogEntry) {
	t.Helper()
	doneCh := make(chan ProcessState, 4)
	pm := NewProcessManager(RunnerCallbacks{
		OnStatus: func(state ProcessState) {
			if state.Status != StatusRunning {
				doneCh <- state
			}
		},
	})

	err := pm.StartCommand("proj-1", "cmd-1", dir, "", commandLine, shell, shellCfg)
	require.NoError(t, err)

	select {
	case finalState := <-doneCh:
		return finalState, pm.GetLogs("cmd-1")
	case <-time.After(15 * time.Second):
		_ = pm.StopCommand("cmd-1")
		t.Fatalf("command timed out: %q", commandLine)
		return ProcessState{}, nil
	}
}

func collectStreamLines(logs []LogEntry, stream string) string {
	var parts []string
	for _, entry := range logs {
		if entry.Stream == stream {
			parts = append(parts, entry.Line)
		}
	}
	return strings.Join(parts, "\n")
}

func TestBuildShellCommand_CMDVerbatimQuotes(t *testing.T) {
	cases := []string{
		`"C:\Program Files\App\tool.exe" --flag "val"`,
		`set "FOO=bar" & echo %FOO%`,
	}

	for _, tc := range cases {
		cmd, cleanup, err := buildShellCommand(t.TempDir(), tc, ShellCMD, ShellConfig{})
		require.NoError(t, err)
		if cleanup != nil {
			cleanup()
		}
		require.NotNil(t, cmd.SysProcAttr)
		rawLine := cmd.SysProcAttr.CmdLine
		assert.NotContains(t, rawLine, `\"`, "cmd.exe /C must not backslash-escape double quotes")
		assert.Contains(t, rawLine, tc)
		assert.Contains(t, rawLine, "/S /C")
	}
}

func TestStartCommand_CMDQuotedPathWithSpaces(t *testing.T) {
	root := t.TempDir()
	spacedDir := filepath.Join(root, "Program Files Demo")
	require.NoError(t, os.MkdirAll(spacedDir, 0755))

	toolPath := filepath.Join(spacedDir, "echo tool.cmd")
	require.NoError(t, os.WriteFile(toolPath, []byte("@echo off\r\necho ARG1=%~1\r\n"), 0644))

	cmdLine := `"` + toolPath + `" "hello world"`
	state, logs := runManagedCommandForTest(t, root, cmdLine, ShellCMD, ShellConfig{})

	stdout := collectStreamLines(logs, "stdout")
	stderr := collectStreamLines(logs, "stderr")
	assert.Equal(t, StatusStopped, state.Status, "stderr: %s", stderr)
	assert.Equal(t, 0, state.ExitCode)
	assert.Contains(t, stdout, "ARG1=hello world")
	assert.NotContains(t, stderr, `\"`)
}

func TestStartCommand_CMDSetQuotedVar(t *testing.T) {
	state, logs := runManagedCommandForTest(t, t.TempDir(), `set "FOO=bar" & set FOO`, ShellCMD, ShellConfig{})

	stdout := collectStreamLines(logs, "stdout")
	stderr := collectStreamLines(logs, "stderr")
	assert.Equal(t, StatusStopped, state.Status, "stderr: %s", stderr)
	assert.Equal(t, 0, state.ExitCode)
	assert.Contains(t, stdout, "FOO=bar")
}

func TestStartCommand_CMDMultiline(t *testing.T) {
	scriptTmp := t.TempDir()
	t.Setenv("TMP", scriptTmp)
	t.Setenv("TEMP", scriptTmp)

	cmdLine := "set \"FOO=hello world\"\necho %FOO%"
	state, logs := runManagedCommandForTest(t, t.TempDir(), cmdLine, ShellCMD, ShellConfig{})

	stdout := collectStreamLines(logs, "stdout")
	stderr := collectStreamLines(logs, "stderr")
	assert.Equal(t, StatusStopped, state.Status, "stderr: %s", stderr)
	assert.Equal(t, 0, state.ExitCode)
	assert.Contains(t, stdout, "hello world")

	leftover, err := os.ReadDir(scriptTmp)
	require.NoError(t, err)
	assert.Empty(t, leftover, "temporary .cmd script must be removed on completion")
}

func TestStartCommand_PowerShellMultilineAndUTF8(t *testing.T) {
	scriptTmp := t.TempDir()
	t.Setenv("TMP", scriptTmp)
	t.Setenv("TEMP", scriptTmp)

	cmdLine := "$env:FOO = \"bar baz\"\nWrite-Output \"中文:$($env:FOO)\""
	state, logs := runManagedCommandForTest(t, t.TempDir(), cmdLine, ShellPowerShell, ShellConfig{})

	stdout := collectStreamLines(logs, "stdout")
	stderr := collectStreamLines(logs, "stderr")
	assert.Equal(t, StatusStopped, state.Status, "stderr: %s", stderr)
	assert.Equal(t, 0, state.ExitCode)
	assert.Contains(t, stdout, "中文:bar baz")
	assert.NotContains(t, stderr, "#< CLIXML")

	leftover, err := os.ReadDir(scriptTmp)
	require.NoError(t, err)
	assert.Empty(t, leftover, "temporary .ps1 script must be removed on completion")
}

func TestStartCommand_PowerShellExitCodes(t *testing.T) {
	dir := t.TempDir()

	nativeState, nativeLogs := runManagedCommandForTest(t, dir, `cmd.exe /c "exit 42"`, ShellPowerShell, ShellConfig{})
	assert.Equal(t, StatusError, nativeState.Status)
	assert.Equal(t, 42, nativeState.ExitCode)
	assert.NotContains(t, collectStreamLines(nativeLogs, "stderr"), "#< CLIXML")

	missingPath := filepath.Join(dir, "definitely_missing_item_xyz")
	cmdletState, cmdletLogs := runManagedCommandForTest(t, dir, `Get-Item "`+missingPath+`"`, ShellPowerShell, ShellConfig{})
	cmdletStderr := collectStreamLines(cmdletLogs, "stderr")
	assert.Equal(t, StatusError, cmdletState.Status)
	assert.Equal(t, 1, cmdletState.ExitCode)
	assert.NotEmpty(t, cmdletStderr)
	assert.NotContains(t, cmdletStderr, "#< CLIXML")
}

func TestStartCommand_DefaultShellIsPowerShell(t *testing.T) {
	cmdLine := "$env:FOO = \"pwsh default\"\nWrite-Output \"EDITION=$($PSVersionTable.PSEdition):$($env:FOO)\""
	state, logs := runManagedCommandForTest(t, t.TempDir(), cmdLine, "", ShellConfig{})

	stdout := collectStreamLines(logs, "stdout")
	stderr := collectStreamLines(logs, "stderr")
	assert.Equal(t, StatusStopped, state.Status, "stderr: %s", stderr)
	assert.Equal(t, 0, state.ExitCode)
	assert.Contains(t, stdout, ":pwsh default")
	assert.NotContains(t, stderr, "#< CLIXML")
}

func TestStartCommand_OverrideCMDWhenDefaultPowerShell(t *testing.T) {
	state, logs := runManagedCommandForTest(
		t,
		t.TempDir(),
		`set "FOO=bar" & set FOO`,
		ShellCMD,
		ShellConfig{DefaultShell: ShellPowerShell},
	)

	stdout := collectStreamLines(logs, "stdout")
	stderr := collectStreamLines(logs, "stderr")
	assert.Equal(t, StatusStopped, state.Status, "stderr: %s", stderr)
	assert.Equal(t, 0, state.ExitCode)
	assert.Contains(t, stdout, "FOO=bar")
}

func TestStartCommand_GitBashMultilineUTF8AndExitCode(t *testing.T) {
	bashExe, _, ok := ResolveGitBashExe("")
	if !ok || bashExe == "" {
		t.Skip("Git Bash not installed on host")
	}

	scriptTmp := t.TempDir()
	t.Setenv("TMP", scriptTmp)
	t.Setenv("TEMP", scriptTmp)

	workDir := filepath.Join(t.TempDir(), "bash workdir")
	require.NoError(t, os.MkdirAll(workDir, 0755))

	cmdLine := "export FOO=\"bar baz\"\nprintf '中文:%s\\n' \"$FOO\"\npwd"
	state, logs := runManagedCommandForTest(t, workDir, cmdLine, ShellGitBash, ShellConfig{})

	stdout := collectStreamLines(logs, "stdout")
	stderr := collectStreamLines(logs, "stderr")
	assert.Equal(t, StatusStopped, state.Status, "stderr: %s", stderr)
	assert.Equal(t, 0, state.ExitCode)
	assert.Contains(t, stdout, "中文:bar baz")
	assert.Contains(t, stdout, "bash workdir")

	leftover, err := os.ReadDir(scriptTmp)
	require.NoError(t, err)
	assert.Empty(t, leftover, "temporary .sh script must be removed on completion")

	failState, _ := runManagedCommandForTest(t, workDir, "echo failing >&2\nexit 23", ShellGitBash, ShellConfig{})
	assert.Equal(t, StatusError, failState.Status)
	assert.Equal(t, 23, failState.ExitCode)
}

func TestResolveGitBashExe_ExcludesWSLBashAndValidatesCustomPath(t *testing.T) {
	assert.True(t, isWSLBashPath(`C:\Windows\System32\bash.exe`))
	assert.True(t, isWSLBashPath(`c:\windows\syswow64\bash.exe`))
	assert.True(t, isWSLBashPath(`C:\Users\Demo\AppData\Local\Microsoft\WindowsApps\bash.exe`))
	assert.False(t, isWSLBashPath(`C:\Software\Git\bin\bash.exe`))

	missingPath := filepath.Join(t.TempDir(), "missing-bash.exe")
	resolved, detail, ok := ResolveGitBashExe(missingPath)
	assert.False(t, ok)
	assert.Empty(t, resolved)
	assert.Equal(t, "指定的路径不存在", detail)

	customBash := filepath.Join(t.TempDir(), "bash.exe")
	require.NoError(t, os.WriteFile(customBash, []byte("stub"), 0644))
	resolved, detail, ok = ResolveGitBashExe(customBash)
	assert.True(t, ok)
	assert.Equal(t, customBash, resolved)
	assert.Equal(t, "手动指定", detail)
}
