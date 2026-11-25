//go:build windows

package envmgr

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	afInet                  = 2
	afInet6                 = 23
	tcpTableOwnerPIDListen  = 3
	errInsufficientBuffer   = 122
	errNoError              = 0
)

var (
	modIPHlpAPI             = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetExtendedTcpTable = modIPHlpAPI.NewProc("GetExtendedTcpTable")
)

type mibTCPRowOwnerPID struct {
	State      uint32
	LocalAddr  uint32
	LocalPort  uint32
	RemoteAddr uint32
	RemotePort uint32
	OwningPID  uint32
}

type mibTCP6RowOwnerPID struct {
	LocalAddr     [16]byte
	LocalScopeID  uint32
	LocalPort     uint32
	RemoteAddr    [16]byte
	RemoteScopeID uint32
	RemotePort    uint32
	State         uint32
	OwningPID     uint32
}

func ntohsPort(raw uint32) int {
	p := uint16(raw)
	return int((p<<8)&0xFF00 | (p>>8)&0x00FF)
}

// collectProcessSnapshot captures parent->children links and pid->executable name in a single Toolhelp32 pass.
func collectProcessSnapshot() (children map[int][]int, names map[int]string, err error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, nil, err
	}
	defer windows.CloseHandle(snap)

	children = make(map[int][]int)
	names = make(map[int]string)

	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return children, names, nil
	}
	for {
		pid := int(entry.ProcessID)
		ppid := int(entry.ParentProcessID)
		if pid > 0 {
			children[ppid] = append(children[ppid], pid)
			names[pid] = windows.UTF16ToString(entry.ExeFile[:])
		}
		if err := windows.Process32Next(snap, &entry); err != nil {
			break
		}
	}
	return children, names, nil
}

// collectDescendantPIDs returns the set containing rootPID and all its descendant PIDs.
func collectDescendantPIDs(rootPID int, children map[int][]int) map[int]bool {
	set := make(map[int]bool)
	if rootPID <= 0 {
		return set
	}
	queue := []int{rootPID}
	set[rootPID] = true
	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		for _, child := range children[curr] {
			if !set[child] {
				set[child] = true
				queue = append(queue, child)
			}
		}
	}
	return set
}

// ListListeningTCPSockets queries Windows IPv4 and IPv6 listening TCP sockets with owning PID and process name.
func ListListeningTCPSockets() ([]TCPListener, error) {
	_, procNames, _ := collectProcessSnapshot()
	return listListeningTCPSocketsWithNames(procNames)
}

func listListeningTCPSocketsWithNames(procNames map[int]string) ([]TCPListener, error) {
	v4Rows, errV4 := queryTCPv4Listeners()
	v6Rows, errV6 := queryTCPv6Listeners()
	if errV4 != nil && errV6 != nil {
		return nil, fmt.Errorf("查询系统 TCP 监听表失败: %w", errV4)
	}

	type dedupKey struct {
		pid  int
		port int
	}
	merged := make(map[dedupKey]TCPListener)

	resolveName := func(pid int) string {
		if name := strings.TrimSpace(procNames[pid]); name != "" {
			return name
		}
		if name := queryProcessNameByPID(pid); name != "" {
			return name
		}
		return fmt.Sprintf("PID %d", pid)
	}

	addListener := func(pid, port int, addr string, prefer bool) {
		if pid <= 0 || !isValidPort(port) {
			return
		}
		key := dedupKey{pid: pid, port: port}
		if existing, exists := merged[key]; exists {
			if prefer && !strings.Contains(addr, ":") && strings.Contains(existing.Address, ":") {
				existing.Address = addr
				merged[key] = existing
			}
			return
		}
		merged[key] = TCPListener{
			Port:        port,
			Address:     addr,
			PID:         pid,
			ProcessName: resolveName(pid),
		}
	}

	for _, row := range v4Rows {
		port := ntohsPort(row.LocalPort)
		ip := net.IPv4(
			byte(row.LocalAddr),
			byte(row.LocalAddr>>8),
			byte(row.LocalAddr>>16),
			byte(row.LocalAddr>>24),
		).String()
		addListener(int(row.OwningPID), port, ip, true)
	}

	for _, row := range v6Rows {
		port := ntohsPort(row.LocalPort)
		ip := net.IP(row.LocalAddr[:]).String()
		addListener(int(row.OwningPID), port, ip, false)
	}

	out := make([]TCPListener, 0, len(merged))
	for _, l := range merged {
		out = append(out, l)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Port != out[j].Port {
			return out[i].Port < out[j].Port
		}
		return out[i].PID < out[j].PID
	})
	return out, nil
}

func queryTCPv4Listeners() ([]mibTCPRowOwnerPID, error) {
	var size uint32
	ret, _, _ := procGetExtendedTcpTable.Call(
		0,
		uintptr(unsafe.Pointer(&size)),
		0,
		uintptr(afInet),
		uintptr(tcpTableOwnerPIDListen),
		0,
	)
	if ret != errInsufficientBuffer && ret != errNoError {
		return nil, fmt.Errorf("GetExtendedTcpTable(IPv4) size query failed: %d", ret)
	}
	if size < 4 {
		return nil, nil
	}

	// Retry once if the table grows between the two calls
	for attempt := 0; attempt < 3; attempt++ {
		buf := make([]byte, size+1024)
		bufSize := uint32(len(buf))
		ret, _, _ = procGetExtendedTcpTable.Call(
			uintptr(unsafe.Pointer(&buf[0])),
			uintptr(unsafe.Pointer(&bufSize)),
			0,
			uintptr(afInet),
			uintptr(tcpTableOwnerPIDListen),
			0,
		)
		if ret == errInsufficientBuffer {
			size = bufSize
			continue
		}
		if ret != errNoError {
			return nil, fmt.Errorf("GetExtendedTcpTable(IPv4) failed: %d", ret)
		}
		count := *(*uint32)(unsafe.Pointer(&buf[0]))
		if count == 0 {
			return nil, nil
		}
		rowSize := unsafe.Sizeof(mibTCPRowOwnerPID{})
		if uintptr(4)+uintptr(count)*rowSize > uintptr(len(buf)) {
			return nil, errors.New("IPv4 TCP table truncated")
		}
		rows := unsafe.Slice((*mibTCPRowOwnerPID)(unsafe.Pointer(&buf[4])), count)
		out := make([]mibTCPRowOwnerPID, len(rows))
		copy(out, rows)
		return out, nil
	}
	return nil, errors.New("GetExtendedTcpTable(IPv4) exceeded retries")
}

func queryTCPv6Listeners() ([]mibTCP6RowOwnerPID, error) {
	var size uint32
	ret, _, _ := procGetExtendedTcpTable.Call(
		0,
		uintptr(unsafe.Pointer(&size)),
		0,
		uintptr(afInet6),
		uintptr(tcpTableOwnerPIDListen),
		0,
	)
	if ret != errInsufficientBuffer && ret != errNoError {
		return nil, fmt.Errorf("GetExtendedTcpTable(IPv6) size query failed: %d", ret)
	}
	if size < 4 {
		return nil, nil
	}

	for attempt := 0; attempt < 3; attempt++ {
		buf := make([]byte, size+1024)
		bufSize := uint32(len(buf))
		ret, _, _ = procGetExtendedTcpTable.Call(
			uintptr(unsafe.Pointer(&buf[0])),
			uintptr(unsafe.Pointer(&bufSize)),
			0,
			uintptr(afInet6),
			uintptr(tcpTableOwnerPIDListen),
			0,
		)
		if ret == errInsufficientBuffer {
			size = bufSize
			continue
		}
		if ret != errNoError {
			return nil, fmt.Errorf("GetExtendedTcpTable(IPv6) failed: %d", ret)
		}
		count := *(*uint32)(unsafe.Pointer(&buf[0]))
		if count == 0 {
			return nil, nil
		}
		rowSize := unsafe.Sizeof(mibTCP6RowOwnerPID{})
		if uintptr(4)+uintptr(count)*rowSize > uintptr(len(buf)) {
			return nil, errors.New("IPv6 TCP table truncated")
		}
		rows := unsafe.Slice((*mibTCP6RowOwnerPID)(unsafe.Pointer(&buf[4])), count)
		out := make([]mibTCP6RowOwnerPID, len(rows))
		copy(out, rows)
		return out, nil
	}
	return nil, errors.New("GetExtendedTcpTable(IPv6) exceeded retries")
}

func queryProcessNameByPID(pid int) string {
	if pid <= 0 {
		return ""
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)

	buf := make([]uint16, windows.MAX_PATH*2)
	n := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(h, 0, &buf[0], &n); err != nil || n == 0 {
		return ""
	}
	fullPath := windows.UTF16ToString(buf[:n])
	return filepath.Base(fullPath)
}

// KillExternalProcess terminates a non-managed process occupying a conflicting port.
func KillExternalProcess(pid int) error {
	if pid <= 4 {
		return errors.New("无法终止系统关键进程")
	}
	if pid == os.Getpid() {
		return errors.New("无法终止 Graviton 自身进程")
	}
	if err := killProcessTree(pid); err == nil {
		return nil
	}

	h, err := windows.OpenProcess(windows.PROCESS_TERMINATE, false, uint32(pid))
	if err != nil {
		return fmt.Errorf("无法终止进程 (PID %d)，可能需要管理员权限: %w", pid, err)
	}
	defer windows.CloseHandle(h)
	if err := windows.TerminateProcess(h, 1); err != nil {
		return fmt.Errorf("终止进程 (PID %d) 失败: %w", pid, err)
	}
	return nil
}
