package widget

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"time"

	"graviton/internal/appservice"
)

const WidgetWindowTitle = "Graviton Widget"

// StateSnapshot is the shared state synchronized between the main app and the floating widget.
type StateSnapshot struct {
	Accounts      []appservice.AccountDisplay `json:"accounts"`
	Theme         string                      `json:"theme"`
	RefreshingAll bool                        `json:"refreshingAll"`
	RefreshingIDs map[string]bool             `json:"refreshingIds"`
	SwitchingIDs  map[string]bool             `json:"switchingIds"`
	LastUpdated       string                      `json:"lastUpdated"`
	WidgetLocked      bool                        `json:"widgetLocked"`
	WidgetAlwaysOnTop bool                        `json:"widgetAlwaysOnTop"`
	ResetTimeFormat   string                      `json:"resetTimeFormat,omitempty"`
}

// Handlers defines callbacks invoked by the local IPC server on behalf of the widget.
type Handlers struct {
	GetState      func() StateSnapshot
	Refresh       func(id string) error
	Switch        func(id string) error
	OpenMain      func()
	CloseWidget   func()
	SavePosition  func(x, y int)
	SetLocked     func(locked bool)
	OnWidgetExit  func()
}

// Manager manages the local HTTP/SSE IPC server and the floating widget child process.
type Manager struct {
	mu       sync.Mutex
	port     int
	token    string
	server   *http.Server
	cmd      *exec.Cmd
	handlers Handlers

	clientsMu sync.Mutex
	clients   map[chan []byte]struct{}
}

// NewManager creates a new widget Manager.
func NewManager(handlers Handlers) *Manager {
	return &Manager{
		token:    randomToken(),
		handlers: handlers,
		clients:  make(map[chan []byte]struct{}),
	}
}

func randomToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// StartServer starts the local loopback HTTP/SSE server for widget communication.
func (m *Manager) StartServer() error {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("failed to listen on loopback: %w", err)
	}

	m.mu.Lock()
	m.port = ln.Addr().(*net.TCPAddr).Port
	m.mu.Unlock()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/state", m.withAuth(m.handleState))
	mux.HandleFunc("/api/events", m.withAuth(m.handleEvents))
	mux.HandleFunc("/api/refresh", m.withAuth(m.handleRefresh))
	mux.HandleFunc("/api/switch", m.withAuth(m.handleSwitch))
	mux.HandleFunc("/api/open-main", m.withAuth(m.handleOpenMain))
	mux.HandleFunc("/api/close-widget", m.withAuth(m.handleCloseWidget))
	mux.HandleFunc("/api/widget-pos", m.withAuth(m.handleWidgetPos))
	mux.HandleFunc("/api/widget-lock", m.withAuth(m.handleWidgetLock))

	srv := &http.Server{Handler: mux}
	m.mu.Lock()
	m.server = srv
	m.mu.Unlock()

	go func() {
		_ = srv.Serve(ln)
	}()

	return nil
}

// Stop shuts down the widget process (if running) and the local IPC server.
func (m *Manager) Stop() {
	m.StopWidget()

	m.mu.Lock()
	srv := m.server
	m.server = nil
	m.mu.Unlock()

	if srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}
}

// BroadcastState pushes the latest state snapshot to all connected widget SSE clients.
func (m *Manager) BroadcastState() {
	if m.handlers.GetState == nil {
		return
	}
	snap := m.handlers.GetState()
	data, err := json.Marshal(snap)
	if err != nil {
		return
	}

	m.clientsMu.Lock()
	defer m.clientsMu.Unlock()
	for ch := range m.clients {
		select {
		case ch <- data:
		default:
			// Drop if client channel is backed up
		}
	}
}

// StartWidget spawns the floating widget process if it is not already running.
func (m *Manager) StartWidget() error {
	m.mu.Lock()
	if m.cmd != nil && m.cmd.Process != nil {
		m.mu.Unlock()
		return nil
	}
	port := m.port
	token := m.token
	m.mu.Unlock()

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to locate executable: %w", err)
	}

	cmd := exec.Command(exe,
		"--widget",
		fmt.Sprintf("--port=%d", port),
		fmt.Sprintf("--token=%s", token),
	)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start widget process: %w", err)
	}

	// Safety net: child dies with the main process even if it is force-killed.
	bindToJob(cmd)

	m.mu.Lock()
	m.cmd = cmd
	m.mu.Unlock()

	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		if m.cmd == cmd {
			m.cmd = nil
		}
		m.mu.Unlock()
		if m.handlers.OnWidgetExit != nil {
			m.handlers.OnWidgetExit()
		}
	}()

	return nil
}

// StopWidget terminates the floating widget process if running.
func (m *Manager) StopWidget() {
	m.mu.Lock()
	cmd := m.cmd
	m.cmd = nil
	m.mu.Unlock()

	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

// IsWidgetRunning reports whether the floating widget process is currently alive.
func (m *Manager) IsWidgetRunning() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cmd != nil && m.cmd.Process != nil
}

func (m *Manager) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		token := r.URL.Query().Get("token")
		if token == "" {
			auth := r.Header.Get("Authorization")
			if len(auth) > 7 && auth[:7] == "Bearer " {
				token = auth[7:]
			}
		}

		if token != m.token {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		next(w, r)
	}
}

func (m *Manager) handleState(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	snap := m.handlers.GetState()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snap)
}

func (m *Manager) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := make(chan []byte, 16)
	m.clientsMu.Lock()
	m.clients[ch] = struct{}{}
	m.clientsMu.Unlock()

	defer func() {
		m.clientsMu.Lock()
		delete(m.clients, ch)
		m.clientsMu.Unlock()
	}()

	// Push initial state immediately
	if m.handlers.GetState != nil {
		if data, err := json.Marshal(m.handlers.GetState()); err == nil {
			_, _ = fmt.Fprintf(w, "event: state\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}

	keepalive := time.NewTicker(25 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case data := <-ch:
			_, _ = fmt.Fprintf(w, "event: state\ndata: %s\n\n", data)
			flusher.Flush()
		case <-keepalive.C:
			_, _ = fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func (m *Manager) handleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	if m.handlers.Refresh != nil {
		if err := m.handlers.Refresh(body.ID); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (m *Manager) handleSwitch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ID == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	if m.handlers.Switch != nil {
		if err := m.handlers.Switch(body.ID); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (m *Manager) handleOpenMain(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if m.handlers.OpenMain != nil {
		m.handlers.OpenMain()
	}
	w.WriteHeader(http.StatusNoContent)
}

func (m *Manager) handleCloseWidget(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if m.handlers.CloseWidget != nil {
		go m.handlers.CloseWidget()
	}
	w.WriteHeader(http.StatusNoContent)
}

func (m *Manager) handleWidgetPos(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		X int `json:"x"`
		Y int `json:"y"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if m.handlers.SavePosition != nil {
		m.handlers.SavePosition(body.X, body.Y)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (m *Manager) handleWidgetLock(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Locked bool `json:"locked"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if m.handlers.SetLocked != nil {
		m.handlers.SetLocked(body.Locked)
	}
	w.WriteHeader(http.StatusNoContent)
}
