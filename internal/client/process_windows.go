//go:build windows

package client

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modkernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procCreateToolhelp32Snapshot = modkernel32.NewProc("CreateToolhelp32Snapshot")
	procProcess32FirstW          = modkernel32.NewProc("Process32FirstW")
	procProcess32NextW           = modkernel32.NewProc("Process32NextW")
)

const (
	TH32CS_SNAPPROCESS = 0x00000002
)

type processEntry32W struct {
	dwSize              uint32
	cntUsage            uint32
	th32ProcessID       uint32
	th32DefaultHeapID   uintptr
	th32ModuleID        uint32
	cntThreads          uint32
	th32ParentProcessID uint32
	pcPriClassBase      int32
	dwFlags             uint32
	szExeFile           [windows.MAX_PATH]uint16
}

type ProcessInfo struct {
	PID       uint32
	ParentPID uint32
	ExeFile   string
	ExePath   string
}

// SnapshotProcesses returns all current running processes.
func SnapshotProcesses() ([]ProcessInfo, error) {
	hSnapshot, _, err := procCreateToolhelp32Snapshot.Call(uintptr(TH32CS_SNAPPROCESS), 0)
	if hSnapshot == uintptr(windows.InvalidHandle) {
		return nil, fmt.Errorf("CreateToolhelp32Snapshot failed: %w", err)
	}
	defer windows.CloseHandle(windows.Handle(hSnapshot))

	var entry processEntry32W
	entry.dwSize = uint32(unsafe.Sizeof(entry))

	r1, _, _ := procProcess32FirstW.Call(hSnapshot, uintptr(unsafe.Pointer(&entry)))
	if r1 == 0 {
		return nil, errors.New("Process32FirstW failed")
	}

	var list []ProcessInfo
	for {
		name := windows.UTF16ToString(entry.szExeFile[:])
		pInfo := ProcessInfo{
			PID:       entry.th32ProcessID,
			ParentPID: entry.th32ParentProcessID,
			ExeFile:   name,
		}

		// Try resolving full path
		hProc, errOpen := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, entry.th32ProcessID)
		if errOpen == nil {
			var buf [windows.MAX_PATH]uint16
			size := uint32(len(buf))
			if errQuery := windows.QueryFullProcessImageName(hProc, 0, &buf[0], &size); errQuery == nil {
				pInfo.ExePath = windows.UTF16ToString(buf[:size])
			}
			windows.CloseHandle(hProc)
		}

		list = append(list, pInfo)

		rNext, _, _ := procProcess32NextW.Call(hSnapshot, uintptr(unsafe.Pointer(&entry)))
		if rNext == 0 {
			break
		}
	}

	return list, nil
}

// IsAntigravityMainProcess checks if the process matches Antigravity main application.
func IsAntigravityMainProcess(p ProcessInfo, myPID uint32) bool {
	if p.PID == myPID {
		return false
	}
	name := strings.ToLower(p.ExeFile)
	path := strings.ToLower(p.ExePath)

	// Exclude self and manager tools
	if strings.Contains(name, "codetool") || strings.Contains(path, "codetool") {
		return false
	}
	if strings.Contains(name, "antigravity-tools") || strings.Contains(path, "antigravity-tools") {
		return false
	}
	if strings.Contains(name, "antigravity_tools") || strings.Contains(path, "antigravity_tools") {
		return false
	}
	if strings.Contains(name, "language_server") || strings.Contains(path, "language_server") {
		return false
	}

	// Must match Antigravity
	if name == "antigravity.exe" || name == "antigravity" {
		return true
	}
	if strings.Contains(path, "antigravity") && strings.HasSuffix(name, ".exe") && !strings.Contains(name, "helper") && !strings.Contains(name, "crashpad") {
		return true
	}

	return false
}

// FindRunningAntigravityMain searches for the active main Antigravity process (the root of the process tree).
func FindRunningAntigravityMain() (*ProcessInfo, error) {
	myPID := uint32(os.Getpid())
	procs, err := SnapshotProcesses()
	if err != nil {
		return nil, err
	}

	// 1. Gather all candidate processes matching Antigravity executable
	var candidates []ProcessInfo
	candPIDs := make(map[uint32]bool)
	for _, p := range procs {
		if IsAntigravityMainProcess(p, myPID) {
			candidates = append(candidates, p)
			candPIDs[p.PID] = true
		}
	}

	if len(candidates) == 0 {
		return nil, nil
	}

	// 2. The main/root process is the one whose ParentPID is NOT in candPIDs
	var rootCandidates []ProcessInfo
	for _, p := range candidates {
		if !candPIDs[p.ParentPID] {
			rootCandidates = append(rootCandidates, p)
		}
	}

	// If exactly one root candidate, that is our main process
	if len(rootCandidates) == 1 {
		res := rootCandidates[0]
		return &res, nil
	}

	// If multiple roots, prioritize the one that has language_server descendants
	for _, root := range rootCandidates {
		ls, _ := FindLanguageServerDescendants(root.PID)
		if len(ls) > 0 {
			res := root
			return &res, nil
		}
	}

	if len(rootCandidates) > 0 {
		res := rootCandidates[0]
		return &res, nil
	}

	// Fallback to first candidate
	res := candidates[0]
	return &res, nil
}

// FindLanguageServerDescendants returns the PIDs of language_server subprocesses
// under the main Antigravity PID tree.
func FindLanguageServerDescendants(mainPID uint32) ([]uint32, error) {
	procs, err := SnapshotProcesses()
	if err != nil {
		return nil, err
	}

	// Build parent -> children map
	childMap := make(map[uint32][]ProcessInfo)
	for _, p := range procs {
		childMap[p.ParentPID] = append(childMap[p.ParentPID], p)
	}

	// BFS traversal
	var lsPIDs []uint32
	queue := []uint32{mainPID}
	visited := map[uint32]bool{mainPID: true}

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]

		for _, child := range childMap[curr] {
			if !visited[child.PID] {
				visited[child.PID] = true
				queue = append(queue, child.PID)

				name := strings.ToLower(child.ExeFile)
				path := strings.ToLower(child.ExePath)
				if strings.Contains(name, "language_server") || strings.Contains(path, "language_server") {
					lsPIDs = append(lsPIDs, child.PID)
				}
			}
		}
	}

	return lsPIDs, nil
}

// SweepOrphanLanguageServers terminates any orphan language_server processes left behind.
func SweepOrphanLanguageServers() {
	procs, err := SnapshotProcesses()
	if err != nil {
		return
	}
	parentExists := make(map[uint32]bool)
	for _, p := range procs {
		parentExists[p.PID] = true
	}
	for _, p := range procs {
		name := strings.ToLower(p.ExeFile)
		path := strings.ToLower(p.ExePath)
		if strings.Contains(name, "language_server") || strings.Contains(path, "language_server") {
			// If parent is dead or not running
			if !parentExists[p.ParentPID] {
				_ = KillPID(p.PID)
			}
		}
	}
}

// GetProcessCommandLine retrieves the raw command line of a process by PID using WMI.
func GetProcessCommandLine(pid uint32) string {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command",
		fmt.Sprintf("(Get-CimInstance Win32_Process -Filter 'ProcessId = %d').CommandLine", pid))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// ParseCommandLineArgs parses command line arguments using Win32 CommandLineToArgvW and sanitizes internal args.
func ParseCommandLineArgs(cmdLine string) []string {
	if cmdLine == "" {
		return nil
	}
	cmdLinePtr, err := windows.UTF16PtrFromString(cmdLine)
	if err != nil {
		return nil
	}
	var numArgs int32
	argv, err := windows.CommandLineToArgv(cmdLinePtr, &numArgs)
	if err != nil {
		return nil
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(argv)))
	if numArgs <= 1 {
		return nil
	}

	var args []string
	for i := 1; i < int(numArgs) && i < len(argv); i++ {
		arg := windows.UTF16ToString(argv[i][:])
		lower := strings.ToLower(arg)
		// Filter out internal engine and language server flags (matching upstream)
		if strings.HasPrefix(lower, "--standalone") ||
			strings.HasPrefix(lower, "--override_ide_name") ||
			strings.HasPrefix(lower, "--subclient_type") ||
			strings.Contains(lower, "language_server") {
			continue
		}
		args = append(args, arg)
	}
	return args
}

// ClosePIDGraceful attempts a graceful close of a process using taskkill without /F.
func ClosePIDGraceful(pid uint32) error {
	cmd := exec.Command("taskkill", "/PID", strconv.Itoa(int(pid)))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

// KillPID forcefully kills a single PID on Windows.
func KillPID(pid uint32) error {
	cmd := exec.Command("taskkill", "/F", "/PID", strconv.Itoa(int(pid)))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

// KillProcessTree forcefully kills a process and all its children.
func KillProcessTree(pid uint32) error {
	cmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(int(pid)))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}

// WaitForProcessExit polls until the given process PID has exited or timeout expires.
func WaitForProcessExit(pid uint32, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		time.Sleep(300 * time.Millisecond)
		hProc, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
		if err != nil {
			return true // Process no longer exists
		}
		var exitCode uint32
		err = windows.GetExitCodeProcess(hProc, &exitCode)
		windows.CloseHandle(hProc)
		if err != nil || exitCode != 259 { // STILL_ACTIVE is 259
			return true
		}
	}
	return false
}

// WaitForLanguageServerRespawn polls for new language_server child processes for up to timeout.
func WaitForLanguageServerRespawn(mainPID uint32, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		time.Sleep(500 * time.Millisecond)
		pids, err := FindLanguageServerDescendants(mainPID)
		if err == nil && len(pids) > 0 {
			return true
		}
	}
	return false
}

// DetectClientPath finds Antigravity executable path from running process or candidate paths.
func DetectClientPath(overridePath string) (string, error) {
	if overridePath != "" {
		if _, err := os.Stat(overridePath); err == nil {
			return overridePath, nil
		}
		return "", fmt.Errorf("指定的客户端路径不存在: %s", overridePath)
	}

	// Try running process
	if mainProc, err := FindRunningAntigravityMain(); err == nil && mainProc != nil && mainProc.ExePath != "" {
		return mainProc.ExePath, nil
	}

	// Candidate paths
	localAppData := os.Getenv("LOCALAPPDATA")
	progFiles := os.Getenv("ProgramFiles")
	progFilesX86 := os.Getenv("ProgramFiles(x86)")

	candidates := []string{
		filepath.Join(localAppData, "Programs", "Antigravity", "Antigravity.exe"),
		filepath.Join(localAppData, "Antigravity", "Antigravity.exe"),
		filepath.Join(progFiles, "Antigravity", "Antigravity.exe"),
		filepath.Join(progFilesX86, "Antigravity", "Antigravity.exe"),
	}

	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}

	return "", errors.New("未找到 Antigravity 客户端可执行文件，请在设置中指定路径")
}

// DetectClientVersion detects the version string of Antigravity (e.g. "44.5.1").
func DetectClientVersion(clientPath string) string {
	if clientPath == "" {
		return ""
	}
	dir := filepath.Dir(clientPath)
	versionFile := filepath.Join(dir, "version")
	if data, err := os.ReadFile(versionFile); err == nil {
		v := strings.TrimSpace(string(data))
		if v != "" {
			return v
		}
	}
	return ""
}

// IsModernVersion returns true if version is >= 2.0.0, or if version is empty (defaults to modern).
func IsModernVersion(ver string) bool {
	if ver == "" {
		return true // Default modern
	}
	parts := strings.Split(ver, ".")
	if len(parts) > 0 {
		major, err := strconv.Atoi(parts[0])
		if err == nil {
			return major >= 2
		}
	}
	return true
}

// LaunchClient starts the Antigravity application.
func LaunchClient(clientPath string, args ...string) error {
	if clientPath == "" {
		return errors.New("client executable path is empty")
	}
	cmd := exec.Command(clientPath, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: false}
	return cmd.Start()
}
