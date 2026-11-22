package envmgr

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

const maxLogLines = 1000

// NormalizeCommandText standardizes line endings to LF and trims outer whitespace while preserving multi-line bodies.
func NormalizeCommandText(commandLine string) string {
	normalized := strings.ReplaceAll(commandLine, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	return strings.TrimSpace(normalized)
}

func shellDisplayTag(shell string) string {
	switch shell {
	case ShellPowerShell:
		return "PowerShell"
	case ShellGitBash:
		return "Git Bash"
	default:
		return "CMD"
	}
}

func formatStartLogLine(dir, commandLine, shell string, pid int) string {
	tag := shellDisplayTag(shell)
	if strings.Contains(commandLine, "\n") {
		return fmt.Sprintf("> [%s] [%s] (PID: %d)\n%s", dir, tag, pid, commandLine)
	}
	return fmt.Sprintf("> [%s] [%s] %s (PID: %d)", dir, tag, commandLine, pid)
}

var ansiEscapeRe = regexp.MustCompile("\x1b(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^\\x07\\x1b]*(?:\\x07|\x1b\\\\)|[@-Z\\\\-_])")

// ProcessStatus represents the lifecycle state of a managed command.
type ProcessStatus string

const (
	StatusStopped ProcessStatus = "stopped"
	StatusRunning ProcessStatus = "running"
	StatusError   ProcessStatus = "error"
)

// ProcessState is the serializable runtime snapshot for a command.
type ProcessState struct {
	ProjectID string        `json:"projectId"`
	CommandID string        `json:"commandId"`
	Status    ProcessStatus `json:"status"`
	PID       int           `json:"pid"`
	ExitCode  int           `json:"exitCode"`
	StartedAt string        `json:"startedAt,omitempty"`
	ErrorMsg  string        `json:"errorMsg,omitempty"`
}

// LogEntry represents a single stdout/stderr line from a managed command.
type LogEntry struct {
	ProjectID string `json:"projectId"`
	CommandID string `json:"commandId"`
	Stream    string `json:"stream"` // "stdout" | "stderr" | "system"
	Line      string `json:"line"`
	Timestamp string `json:"timestamp"`
}

// RunnerCallbacks receives asynchronous process state and log updates.
type RunnerCallbacks struct {
	OnStatus func(state ProcessState)
	OnLog    func(entry LogEntry)
}

type managedProc struct {
	cmd       *exec.Cmd
	state     ProcessState
	stopping  bool
	doneCh    chan struct{}
}

// ProcessManager manages lifecycle and logs of project commands.
type ProcessManager struct {
	mu        sync.Mutex
	procs     map[string]*managedProc
	logs      map[string][]LogEntry
	callbacks RunnerCallbacks
}

// NewProcessManager creates a ProcessManager with optional event callbacks.
func NewProcessManager(cb RunnerCallbacks) *ProcessManager {
	return &ProcessManager{
		procs:     make(map[string]*managedProc),
		logs:      make(map[string][]LogEntry),
		callbacks: cb,
	}
}

// ResolveCwd resolves a command's working directory against projectRoot.
func ResolveCwd(projectRoot, cwd string) string {
	c := strings.TrimSpace(cwd)
	if c == "" {
		return projectRoot
	}
	if filepath.IsAbs(c) {
		return c
	}
	return filepath.Join(projectRoot, c)
}

// StartCommand starts a command in the background and streams stdout/stderr.
func (pm *ProcessManager) StartCommand(projectID, commandID, projectRoot, cwd, commandLine, shell string, shellCfg ShellConfig) error {
	commandLine = NormalizeCommandText(commandLine)
	if commandLine == "" {
		return errors.New("命令内容不能为空")
	}
	resolvedShell := ResolveEffectiveShell(shell, shellCfg.DefaultShell)

	pm.mu.Lock()
	if existing, ok := pm.procs[commandID]; ok && existing.state.Status == StatusRunning {
		pm.mu.Unlock()
		return errors.New("该指令已在运行中")
	}

	resolvedDir := ResolveCwd(projectRoot, cwd)
	cmd, cleanup, err := buildShellCommand(resolvedDir, commandLine, resolvedShell, shellCfg)
	if err != nil {
		pm.mu.Unlock()
		return fmt.Errorf("构造命令失败: %w", err)
	}
	runCleanup := func() {
		if cleanup != nil {
			cleanup()
		}
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		runCleanup()
		pm.mu.Unlock()
		return fmt.Errorf("创建标准输出管道失败: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		runCleanup()
		pm.mu.Unlock()
		return fmt.Errorf("创建错误输出管道失败: %w", err)
	}

	if err := cmd.Start(); err != nil {
		runCleanup()
		pm.mu.Unlock()
		return fmt.Errorf("启动命令失败: %w", err)
	}

	nowStr := time.Now().Format(time.RFC3339)
	mp := &managedProc{
		cmd:    cmd,
		doneCh: make(chan struct{}),
		state: ProcessState{
			ProjectID: projectID,
			CommandID: commandID,
			Status:    StatusRunning,
			PID:       cmd.Process.Pid,
			StartedAt: nowStr,
		},
	}
	pm.procs[commandID] = mp
	// Reset logs for fresh run
	pm.logs[commandID] = []LogEntry{}
	pm.mu.Unlock()

	pm.appendLog(LogEntry{
		ProjectID: projectID,
		CommandID: commandID,
		Stream:    "system",
		Line:      formatStartLogLine(resolvedDir, commandLine, resolvedShell, cmd.Process.Pid),
		Timestamp: time.Now().Format("15:04:05"),
	})
	pm.emitStatus(mp.state)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		pm.readStream(projectID, commandID, "stdout", stdout)
	}()
	go func() {
		defer wg.Done()
		pm.readStream(projectID, commandID, "stderr", stderr)
	}()

	go func() {
		wg.Wait()
		waitErr := cmd.Wait()
		runCleanup()

		pm.mu.Lock()
		exitCode := 0
		status := StatusStopped
		errMsg := ""
		if waitErr != nil {
			var exitErr *exec.ExitError
			if errors.As(waitErr, &exitErr) {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = -1
			}
			if !mp.stopping {
				status = StatusError
				errMsg = waitErr.Error()
			}
		}
		mp.state.Status = status
		mp.state.ExitCode = exitCode
		mp.state.ErrorMsg = errMsg
		mp.state.PID = 0
		finalState := mp.state
		close(mp.doneCh)
		pm.mu.Unlock()

		pm.appendLog(LogEntry{
			ProjectID: projectID,
			CommandID: commandID,
			Stream:    "system",
			Line:      fmt.Sprintf("> 进程已结束 (状态: %s, 退出码: %d)", status, exitCode),
			Timestamp: time.Now().Format("15:04:05"),
		})
		pm.emitStatus(finalState)
	}()

	return nil
}

// StopCommand terminates a running command's entire process tree.
func (pm *ProcessManager) StopCommand(commandID string) error {
	pm.mu.Lock()
	mp, ok := pm.procs[commandID]
	if !ok || mp.state.Status != StatusRunning || mp.cmd.Process == nil {
		pm.mu.Unlock()
		return nil
	}
	mp.stopping = true
	pid := mp.cmd.Process.Pid
	doneCh := mp.doneCh
	pm.mu.Unlock()

	if err := killProcessTree(pid); err != nil {
		_ = mp.cmd.Process.Kill()
	}

	select {
	case <-doneCh:
	case <-time.After(3 * time.Second):
	}
	return nil
}

// StopAll terminates all currently running managed processes (used on app quit).
func (pm *ProcessManager) StopAll() {
	pm.mu.Lock()
	ids := make([]string, 0)
	for id, mp := range pm.procs {
		if mp.state.Status == StatusRunning {
			ids = append(ids, id)
		}
	}
	pm.mu.Unlock()

	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func(cmdID string) {
			defer wg.Done()
			_ = pm.StopCommand(cmdID)
		}(id)
	}
	wg.Wait()
}

// RunningCount returns the number of commands currently in the running state.
func (pm *ProcessManager) RunningCount() int {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	count := 0
	for _, mp := range pm.procs {
		if mp.state.Status == StatusRunning {
			count++
		}
	}
	return count
}

// HasRunningProcesses reports whether any managed command is still running.
func (pm *ProcessManager) HasRunningProcesses() bool {
	return pm.RunningCount() > 0
}

// GetStates returns a snapshot of all tracked command process states.
func (pm *ProcessManager) GetStates() map[string]ProcessState {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	out := make(map[string]ProcessState, len(pm.procs))
	for k, mp := range pm.procs {
		out[k] = mp.state
	}
	return out
}

// GetLogs returns the buffered log entries for a command.
func (pm *ProcessManager) GetLogs(commandID string) []LogEntry {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	src := pm.logs[commandID]
	out := make([]LogEntry, len(src))
	copy(out, src)
	return out
}

// ClearLogs clears the buffered log entries for a command.
func (pm *ProcessManager) ClearLogs(commandID string) {
	pm.mu.Lock()
	pm.logs[commandID] = []LogEntry{}
	pm.mu.Unlock()
}

func (pm *ProcessManager) readStream(projectID, commandID, stream string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		pm.appendLog(LogEntry{
			ProjectID: projectID,
			CommandID: commandID,
			Stream:    stream,
			Line:      normalizeLogLine(scanner.Bytes()),
			Timestamp: time.Now().Format("15:04:05"),
		})
	}
}

// withUTF8ProcessEnv ensures Python and other CLIs emit unbuffered UTF-8 when attached to pipes.
func withUTF8ProcessEnv(base []string) []string {
	out := make([]string, len(base), len(base)+3)
	copy(out, base)
	defaults := [][2]string{
		{"PYTHONUTF8", "1"},
		{"PYTHONIOENCODING", "utf-8"},
		{"PYTHONUNBUFFERED", "1"},
	}
	for _, kv := range defaults {
		if !hasEnvKey(out, kv[0]) {
			out = append(out, kv[0]+"="+kv[1])
		}
	}
	return out
}

func hasEnvKey(env []string, key string) bool {
	prefix := key + "="
	for _, item := range env {
		if len(item) >= len(prefix) && strings.EqualFold(item[:len(prefix)], prefix) {
			return true
		}
	}
	return false
}

// normalizeLogLine decodes GBK/GB18030 output to UTF-8 if needed and strips ANSI escape sequences.
func normalizeLogLine(raw []byte) string {
	var text string
	if utf8.Valid(raw) {
		text = string(raw)
	} else if decoded, err := simplifiedchinese.GB18030.NewDecoder().Bytes(raw); err == nil {
		text = string(decoded)
	} else {
		text = string(raw)
	}

	text = ansiEscapeRe.ReplaceAllString(text, "")
	if strings.ContainsRune(text, '\r') {
		parts := strings.Split(text, "\r")
		for i := len(parts) - 1; i >= 0; i-- {
			if parts[i] != "" {
				text = parts[i]
				break
			}
		}
	}
	return text
}

func (pm *ProcessManager) appendLog(entry LogEntry) {
	pm.mu.Lock()
	buf := pm.logs[entry.CommandID]
	buf = append(buf, entry)
	if len(buf) > maxLogLines {
		buf = buf[len(buf)-maxLogLines:]
	}
	pm.logs[entry.CommandID] = buf
	pm.mu.Unlock()

	if pm.callbacks.OnLog != nil {
		pm.callbacks.OnLog(entry)
	}
}

func (pm *ProcessManager) emitStatus(state ProcessState) {
	if pm.callbacks.OnStatus != nil {
		pm.callbacks.OnStatus(state)
	}
}
