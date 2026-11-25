package envmgr

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// ListeningPort represents a live TCP listening port owned by a managed process tree.
type ListeningPort struct {
	Port    int    `json:"port"`
	Address string `json:"address"`
	Scheme  string `json:"scheme"` // "http" | "https" | "tcp"
	URL     string `json:"url"`
	PID     int    `json:"pid"`
	Process string `json:"process"`
}

// PortOccupant describes who is currently listening on a conflicting port.
type PortOccupant struct {
	Port        int    `json:"port"`
	Address     string `json:"address"`
	PID         int    `json:"pid"`
	ProcessName string `json:"processName"`
	IsManaged   bool   `json:"isManaged"`
	ProjectID   string `json:"projectId,omitempty"`
	ProjectName string `json:"projectName,omitempty"`
	CommandID   string `json:"commandId,omitempty"`
	CommandName string `json:"commandName,omitempty"`
}

// PortConflictCheck is returned before starting a command when its expected port is occupied.
type PortConflictCheck struct {
	HasConflict   bool          `json:"hasConflict"`
	Port          int           `json:"port,omitempty"`
	SuggestedPort int           `json:"suggestedPort,omitempty"`
	Occupant      *PortOccupant `json:"occupant,omitempty"`
}

// ProjectPortEntry is a single row in the minimalist Port Overview.
type ProjectPortEntry struct {
	Port          int           `json:"port"`
	State         string        `json:"state"` // "running" | "expected"
	URL           string        `json:"url,omitempty"`
	Scheme        string        `json:"scheme,omitempty"`
	ProjectID     string        `json:"projectId"`
	ProjectName   string        `json:"projectName"`
	CommandID     string        `json:"commandId"`
	CommandName   string        `json:"commandName"`
	Cwd           string        `json:"cwd,omitempty"`
	PID           int           `json:"pid,omitempty"`
	ProcessName   string        `json:"processName,omitempty"`
	OverridePort  int           `json:"overridePort,omitempty"`
	ExpectedPort  int           `json:"expectedPort,omitempty"`
	StaticClash   bool          `json:"staticClash"`
	ExternalClash *PortOccupant `json:"externalClash,omitempty"`
}

// PortOverviewSnapshot holds all imported project port entries and summary counters.
type PortOverviewSnapshot struct {
	Entries       []ProjectPortEntry `json:"entries"`
	ConflictCount int                `json:"conflictCount"`
	RunningCount  int                `json:"runningCount"`
}

// TCPListener represents a single OS-level listening TCP socket.
type TCPListener struct {
	Port        int
	Address     string
	PID         int
	ProcessName string
}

var (
	reLogLocalURL   = regexp.MustCompile(`(?i)\b(https?)://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]|(?:\d{1,3}\.){3}\d{1,3}):(\d{2,5})\b`)
	reLogSpringPort = regexp.MustCompile(`(?i)(?:Tomcat|Netty|Jetty|Undertow)\s+started\s+on\s+port(?:\(s\)|s)?(?::)?\s*(\d{2,5})(?:\s*\((https?)\))?`)
)

// extractLogPortHints parses a stdout/stderr line for local HTTP(S) URLs or server-started port notices.
func extractLogPortHints(line string) map[int]string {
	var hints map[int]string
	setHint := func(port int, scheme string) {
		if !isValidPort(port) {
			return
		}
		s := strings.ToLower(strings.TrimSpace(scheme))
		if s != "https" {
			s = "http"
		}
		if hints == nil {
			hints = make(map[int]string)
		}
		// Prefer https if already observed as https
		if prev, ok := hints[port]; !ok || (prev != "https" && s == "https") {
			hints[port] = s
		}
	}

	for _, m := range reLogLocalURL.FindAllStringSubmatch(line, -1) {
		if len(m) == 3 {
			if p, err := strconv.Atoi(m[2]); err == nil {
				setHint(p, m[1])
			}
		}
	}
	for _, m := range reLogSpringPort.FindAllStringSubmatch(line, -1) {
		if len(m) >= 2 {
			if p, err := strconv.Atoi(m[1]); err == nil {
				scheme := "http"
				if len(m) >= 3 && m[2] != "" {
					scheme = m[2]
				}
				setHint(p, scheme)
			}
		}
	}
	return hints
}

// BuildLocalURL constructs a clickable localhost URL for a given scheme and port.
func BuildLocalURL(scheme string, port int) string {
	s := strings.ToLower(strings.TrimSpace(scheme))
	if s != "https" {
		s = "http"
	}
	return fmt.Sprintf("%s://localhost:%d", s, port)
}

// ValidateLocalURL ensures only safe localhost/loopback HTTP(S) URLs are opened in the browser.
func ValidateLocalURL(rawURL string) (string, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return "", errors.New("地址不能为空")
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("无效的本地地址: %w", err)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", errors.New("仅支持打开 http 或 https 本地地址")
	}
	host := strings.ToLower(u.Hostname())
	if host != "localhost" && host != "127.0.0.1" && host != "::1" {
		return "", errors.New("仅允许打开本机 localhost 地址")
	}
	return u.String(), nil
}

// FindAvailablePort returns the first free TCP port starting after preferred.
func FindAvailablePort(preferred int) int {
	start := preferred + 1
	if !isValidPort(start) || start < 1024 {
		start = 3000
	}

	occupied := make(map[int]bool)
	if listeners, err := ListListeningTCPSockets(); err == nil {
		for _, l := range listeners {
			occupied[l.Port] = true
		}
	}

	for offset := 0; offset < 200; offset++ {
		candidate := start + offset
		if candidate > 65535 {
			break
		}
		if occupied[candidate] {
			continue
		}
		if isTCPPortBindable(candidate) {
			return candidate
		}
	}

	// Fallback: ask the OS for an ephemeral port
	if ln, err := net.Listen("tcp", "127.0.0.1:0"); err == nil {
		defer ln.Close()
		if addr, ok := ln.Addr().(*net.TCPAddr); ok && isValidPort(addr.Port) {
			return addr.Port
		}
	}
	return start
}

func isTCPPortBindable(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}

func listeningPortsEqual(a, b []ListeningPort) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func sortListeningPorts(ports []ListeningPort) {
	sort.Slice(ports, func(i, j int) bool {
		if ports[i].Port != ports[j].Port {
			return ports[i].Port < ports[j].Port
		}
		return ports[i].PID < ports[j].PID
	})
}
