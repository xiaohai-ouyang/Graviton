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

// FindRunningAntigravityMain searches for the active main Antigravity process.
func FindRunningAntigravityMain() (*ProcessInfo, error) {
	myPID := uint32(os.Getpid())
	procs, err := SnapshotProcesses()
	if err != nil {
		return nil, err
	}

	for _, p := range procs {
		if IsAntigravityMainProcess(p, myPID) {
			return &p, nil
		}
	}

	return nil, nil
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
	procMap := make(map[uint32]ProcessInfo)
	for _, p := range procs {
		procMap[p.PID] = p
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
