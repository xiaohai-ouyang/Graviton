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
	ProjectID    string          `json:"projectId"`
	CommandID    string          `json:"commandId"`
	Status       ProcessStatus   `json:"status"`
	PID          int             `json:"pid"`
	ExitCode     int             `json:"exitCode"`
	StartedAt    string          `json:"startedAt,omitempty"`
	ErrorMsg     string          `json:"errorMsg,omitempty"`
	Ports        []ListeningPort `json:"ports,omitempty"`
	OverridePort int             `json:"overridePort,omitempty"`
}

// StartOptions configures how a managed command is launched.
type StartOptions struct {
	ProjectID    string
	CommandID    string
	ProjectRoot  string
	Cwd          string
	CommandLine  string
	Shell        string
	ShellCfg     ShellConfig
	OverridePort int
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
	cmd        *exec.Cmd
	state      ProcessState
	stopping   bool
	startedAt  time.Time
	doneCh     chan struct{}
}

// ProcessManager manages lifecycle and logs of project commands.
type ProcessManager struct {
	mu          sync.Mutex
	procs       map[string]*managedProc
	logs        map[string][]LogEntry
	portHints   map[string]map[int]string
	monitorOn   bool
	callbacks   RunnerCallbacks
}

// NewProcessManager creates a ProcessManager with optional event callbacks.
func NewProcessManager(cb RunnerCallbacks) *ProcessManager {
	return &ProcessManager{
		procs:     make(map[string]*managedProc),
		logs:      make(map[string][]LogEntry),
		portHints: make(map[string]map[int]string),
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
	return pm.StartCommandWithOptions(StartOptions{
		ProjectID:   projectID,
		CommandID:   commandID,
		ProjectRoot: projectRoot,
		Cwd:         cwd,
		CommandLine: commandLine,
		Shell:       shell,
		ShellCfg:    shellCfg,
	})
}

// StartCommandWithOptions starts a command with optional temporary port override.
func (pm *ProcessManager) StartCommandWithOptions(opts StartOptions) error {
	projectID := opts.ProjectID
	commandID := opts.CommandID
	commandLine := NormalizeCommandText(opts.CommandLine)
	if commandLine == "" {
		return errors.New("命令内容不能为空")
	}
	resolvedShell := ResolveEffectiveShell(opts.Shell, opts.ShellCfg.DefaultShell)

	pm.mu.Lock()
	if existing, ok := pm.procs[commandID]; ok && existing.state.Status == StatusRunning {
		pm.mu.Unlock()
		return errors.New("该指令已在运行中")
	}

	resolvedDir := ResolveCwd(opts.ProjectRoot, opts.Cwd)
	execCommand := commandLine
	var extraEnv []string
	if isValidPort(opts.OverridePort) {
		execCommand, extraEnv = ApplyTemporaryPortOverride(commandLine, resolvedShell, resolvedDir, opts.OverridePort)
	}

	cmd, cleanup, err := buildShellCommand(resolvedDir, execCommand, resolvedShell, opts.ShellCfg, extraEnv...)
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

	now := time.Now()
	nowStr := now.Format(time.RFC3339)
	mp := &managedProc{
		cmd:       cmd,
		startedAt: now,
		doneCh:    make(chan struct{}),
		state: ProcessState{
			ProjectID:    projectID,
			CommandID:    commandID,
			Status:       StatusRunning,
			PID:          cmd.Process.Pid,
			StartedAt:    nowStr,
			OverridePort: opts.OverridePort,
		},
	}
	pm.procs[commandID] = mp
	// Reset logs and port hints for fresh run
	pm.logs[commandID] = []LogEntry{}
	pm.portHints[commandID] = make(map[int]string)
	pm.ensurePortMonitorLocked()
	pm.mu.Unlock()

	if isValidPort(opts.OverridePort) {
		pm.appendLog(LogEntry{
			ProjectID: projectID,
			CommandID: commandID,
			Stream:    "system",
			Line:      fmt.Sprintf("> [临时换端口] 已使用端口 %d 启动（未修改原配置）", opts.OverridePort),
			Timestamp: time.Now().Format("15:04:05"),
		})
	}
	pm.appendLog(LogEntry{
		ProjectID: projectID,
		CommandID: commandID,
		Stream:    "system",
		Line:      formatStartLogLine(resolvedDir, execCommand, resolvedShell, cmd.Process.Pid),
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
		mp.state.Ports = nil
		mp.state.OverridePort = 0
		delete(pm.portHints, commandID)
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
		st := mp.state
		if len(mp.state.Ports) > 0 {
			st.Ports = append([]ListeningPort(nil), mp.state.Ports...)
		}
		out[k] = st
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
		line := normalizeLogLine(scanner.Bytes())
		if hints := extractLogPortHints(line); len(hints) > 0 {
			pm.recordPortHints(commandID, hints)
		}
		pm.appendLog(LogEntry{
			ProjectID: projectID,
			CommandID: commandID,
			Stream:    stream,
			Line:      line,
			Timestamp: time.Now().Format("15:04:05"),
		})
	}
}

func (pm *ProcessManager) recordPortHints(commandID string, hints map[int]string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	dst := pm.portHints[commandID]
	if dst == nil {
		dst = make(map[int]string)
		pm.portHints[commandID] = dst
	}
	for port, scheme := range hints {
		if prev, ok := dst[port]; !ok || (prev != "https" && scheme == "https") {
			dst[port] = scheme
		}
	}
}

func (pm *ProcessManager) ensurePortMonitorLocked() {
	if pm.monitorOn {
		return
	}
	pm.monitorOn = true
	go pm.portMonitorLoop()
}

func (pm *ProcessManager) portMonitorLoop() {
	for {
		pm.RefreshLivePortsNow()

		pm.mu.Lock()
		runningCount := 0
		fastBurst := false
		now := time.Now()
		for _, mp := range pm.procs {
			if mp.state.Status == StatusRunning {
				runningCount++
				if now.Sub(mp.startedAt) < 10*time.Second {
					fastBurst = true
				}
			}
		}
		if runningCount == 0 {
			pm.monitorOn = false
			pm.mu.Unlock()
			return
		}
		pm.mu.Unlock()

		if fastBurst {
			time.Sleep(500 * time.Millisecond)
		} else {
			time.Sleep(2 * time.Second)
		}
	}
}

// RefreshLivePortsNow probes Windows TCP listeners and updates listening ports for all running managed commands.
func (pm *ProcessManager) RefreshLivePortsNow() []TCPListener {
	pm.mu.Lock()
	type activeTarget struct {
		commandID string
		rootPID   int
		hints     map[int]string
	}
	var targets []activeTarget
	for cmdID, mp := range pm.procs {
		if mp.state.Status == StatusRunning && mp.state.PID > 0 {
			hintsCopy := make(map[int]string, len(pm.portHints[cmdID]))
			for p, s := range pm.portHints[cmdID] {
				hintsCopy[p] = s
			}
			targets = append(targets, activeTarget{
				commandID: cmdID,
				rootPID:   mp.state.PID,
				hints:     hintsCopy,
			})
		}
	}
	pm.mu.Unlock()

	children, names, _ := collectProcessSnapshot()
	listeners, err := listListeningTCPSocketsWithNames(names)
	if err != nil {
		return nil
	}
	if len(targets) == 0 {
		return listeners
	}

	listenerByPort := make(map[int][]TCPListener)
	for _, l := range listeners {
		listenerByPort[l.Port] = append(listenerByPort[l.Port], l)
	}

	var changed []ProcessState

	for _, t := range targets {
		descendants := collectDescendantPIDs(t.rootPID, children)
		portMap := make(map[int]ListeningPort)

		// 1. OS-level listening sockets owned by this command's process tree
		for _, l := range listeners {
			if !descendants[l.PID] {
				continue
			}
			scheme := "http"
			if hinted, ok := t.hints[l.Port]; ok && hinted != "" {
				scheme = hinted
			}
			portMap[l.Port] = ListeningPort{
				Port:    l.Port,
				Address: l.Address,
				Scheme:  scheme,
				URL:     BuildLocalURL(scheme, l.Port),
				PID:     l.PID,
				Process: l.ProcessName,
			}
		}

		// 2. Supplement with log-announced local ports that are confirmed LISTEN on the host
		// (useful for Docker Compose / WSL port-forwarded services whose daemon isn't a direct child PID).
		for hintedPort, scheme := range t.hints {
			if _, exists := portMap[hintedPort]; exists {
				continue
			}
			if ls := listenerByPort[hintedPort]; len(ls) > 0 {
				l := ls[0]
				portMap[hintedPort] = ListeningPort{
					Port:    hintedPort,
					Address: l.Address,
					Scheme:  scheme,
					URL:     BuildLocalURL(scheme, hintedPort),
					PID:     l.PID,
					Process: l.ProcessName,
				}
			}
		}

		nextPorts := make([]ListeningPort, 0, len(portMap))
		for _, lp := range portMap {
			nextPorts = append(nextPorts, lp)
		}
		sortListeningPorts(nextPorts)

		pm.mu.Lock()
		if mp, ok := pm.procs[t.commandID]; ok && mp.state.Status == StatusRunning && mp.state.PID == t.rootPID {
			if !listeningPortsEqual(mp.state.Ports, nextPorts) {
				mp.state.Ports = nextPorts
				stateCopy := mp.state
				stateCopy.Ports = append([]ListeningPort(nil), nextPorts...)
				changed = append(changed, stateCopy)
			}
		}
		pm.mu.Unlock()
	}

	for _, st := range changed {
		pm.emitStatus(st)
	}
	return listeners
}

// GetManagedPIDMap builds a mapping from any PID belonging to a running managed command tree to its ProcessState.
func (pm *ProcessManager) GetManagedPIDMap() map[int]ProcessState {
	pm.mu.Lock()
	type runningItem struct {
		state ProcessState
	}
	var running []runningItem
	for _, mp := range pm.procs {
		if mp.state.Status == StatusRunning && mp.state.PID > 0 {
			st := mp.state
			st.Ports = append([]ListeningPort(nil), mp.state.Ports...)
			running = append(running, runningItem{state: st})
		}
	}
	pm.mu.Unlock()

	out := make(map[int]ProcessState)
	if len(running) == 0 {
		return out
	}
	children, _, _ := collectProcessSnapshot()
	for _, item := range running {
		for pid := range collectDescendantPIDs(item.state.PID, children) {
			out[pid] = item.state
		}
	}
	return out
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
