package updater

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"graviton/internal/buildinfo"
)

const (
	apiTimeout        = 20 * time.Second
	startCheckDelay   = 8 * time.Second
	checkInterval     = 6 * time.Hour
	progressThrottle  = 200 * time.Millisecond
)

// Update statuses surfaced to the frontend state machine.
const (
	StatusIdle        = "idle"
	StatusChecking    = "checking"
	StatusDownloading = "downloading"
	StatusVerifying   = "verifying"
	StatusReady       = "ready"
	StatusWaitingIdle = "waiting_idle"
	StatusInstalling  = "installing"
	StatusUpToDate    = "up_to_date"
	StatusError       = "error"
)

// UpdateState is the sanitized update snapshot pushed to the frontend via "update:state".
type UpdateState struct {
	Status             string   `json:"status"`
	CurrentVersion     string   `json:"currentVersion"`
	Channel            string   `json:"channel"`
	InstallMode        string   `json:"installMode"`
	LatestVersion      string   `json:"latestVersion,omitempty"`
	ReleaseTitle       string   `json:"releaseTitle,omitempty"`
	ReleaseNotes       string   `json:"releaseNotes,omitempty"`
	ReleaseURL         string   `json:"releaseUrl,omitempty"`
	PublishedAt        string   `json:"publishedAt,omitempty"`
	AssetName          string   `json:"assetName,omitempty"`
	DownloadedBytes    int64    `json:"downloadedBytes"`
	TotalBytes         int64    `json:"totalBytes"`
	Progress           int      `json:"progress"`
	ErrorMessage       string   `json:"errorMessage,omitempty"`
	CheckedAt          string   `json:"checkedAt,omitempty"`
	PendingRestart     bool     `json:"pendingRestart"`
	BusyReasons        []string `json:"busyReasons,omitempty"`
	AutoCheckEnabled   bool     `json:"autoCheckEnabled"`
	MirrorURL          string   `json:"mirrorUrl"`
	SkippedVersion     string   `json:"skippedVersion,omitempty"`
	UpdatedFromVersion string   `json:"updatedFromVersion,omitempty"`
}

// Settings is the persisted update configuration owned by the App layer.
type Settings struct {
	AutoCheckEnabled   bool
	MirrorURL          string
	SkippedVersion     string
	UpdatedFromVersion string
}

// Manager coordinates background checks, silent downloads and install readiness.
type Manager struct {
	mu             sync.Mutex
	currentVersion string
	channel        string
	mode           InstallMode
	exePath        string
	cacheDir       string
	github         *GitHubClient
	downloadClient *http.Client
	settings       Settings
	onSettings     func(Settings)
	onState        func(UpdateState)

	state    UpdateState
	release  *ReleaseInfo
	filePath string

	runMu   sync.Mutex
	ctx     context.Context
	cancel  context.CancelFunc
	stopped bool
}

// NewManager builds a Manager. onSettings persists config changes; onState pushes snapshots.
// The cache lives under <cacheBaseDir>/updates; exePath may be empty in tests.
func NewManager(info buildinfo.AppInfo, exePath, cacheBaseDir string, settings Settings, onSettings func(Settings), onState func(UpdateState)) *Manager {
	mode := DetectInstallMode(info.Channel, exePath)
	m := &Manager{
		currentVersion: info.Version,
		channel:        info.Channel,
		mode:           mode,
		exePath:        exePath,
		cacheDir:       filepath.Join(cacheBaseDir, "updates"),
		github:         NewGitHubClient(info.Version, nil),
		downloadClient: NewHTTPClient(0),
		settings:       settings,
		onSettings:     onSettings,
		onState:        onState,
	}
	m.state = UpdateState{
		Status:             StatusIdle,
		CurrentVersion:     info.Version,
		Channel:            info.Channel,
		InstallMode:        string(mode),
		AutoCheckEnabled:   settings.AutoCheckEnabled,
		MirrorURL:          settings.MirrorURL,
		SkippedVersion:     settings.SkippedVersion,
		UpdatedFromVersion: settings.UpdatedFromVersion,
	}
	return m
}

// Start cleans stale artifacts and launches the delayed background check loop.
func (m *Manager) Start() {
	m.cleanupStaleFiles()
	m.mu.Lock()
	if m.stopped {
		m.mu.Unlock()
		return
	}
	m.ctx, m.cancel = context.WithCancel(context.Background())
	ctx := m.ctx
	m.mu.Unlock()

	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(startCheckDelay):
		}
		m.backgroundCheck()
		ticker := time.NewTicker(checkInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				m.backgroundCheck()
			}
		}
	}()
}

// Stop cancels in-flight requests and the background loop.
func (m *Manager) Stop() {
	m.mu.Lock()
	m.stopped = true
	cancel := m.cancel
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// cleanupStaleFiles removes old cached installers, partial downloads, helper scripts and
// the portable .bak left over from a successful update, while preserving apply_update.log.
func (m *Manager) cleanupStaleFiles() {
	if entries, err := os.ReadDir(m.cacheDir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			switch strings.ToLower(filepath.Ext(entry.Name())) {
			case ".exe", ".part", ".ps1":
				_ = os.Remove(filepath.Join(m.cacheDir, entry.Name()))
			}
		}
	}
	if m.exePath != "" && m.mode == ModePortable {
		_ = os.Remove(m.exePath + ".bak")
	}
}

func (m *Manager) snapshot() UpdateState {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

// State returns the current snapshot without emitting.
func (m *Manager) State() UpdateState {
	return m.snapshot()
}

func (m *Manager) emit() {
	if m.onState == nil {
		return
	}
	m.onState(m.snapshot())
}

func (m *Manager) setStatus(status string) {
	m.mu.Lock()
	m.state.Status = status
	m.mu.Unlock()
	m.emit()
}

func (m *Manager) persistSettings() {
	if m.onSettings != nil {
		m.mu.Lock()
		s := m.settings
		m.mu.Unlock()
		m.onSettings(s)
	}
}

// ApplySettings updates auto-check and mirror configuration and persists them.
func (m *Manager) ApplySettings(autoCheck bool, mirrorURL string) error {
	normalized, err := NormalizeMirrorURL(mirrorURL)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.settings.AutoCheckEnabled = autoCheck
	m.settings.MirrorURL = normalized
	m.state.AutoCheckEnabled = autoCheck
	m.state.MirrorURL = normalized
	m.mu.Unlock()
	m.persistSettings()
	m.emit()
	return nil
}

// SkipVersion records a version the user chose to skip and resets an offered update.
func (m *Manager) SkipVersion(version string) {
	m.mu.Lock()
	m.settings.SkippedVersion = version
	m.state.SkippedVersion = version
	if m.state.LatestVersion == version && (m.state.Status == StatusReady || m.state.Status == StatusWaitingIdle) {
		m.resetOfferLocked()
	}
	m.mu.Unlock()
	m.persistSettings()
	m.emit()
}

// DismissUpdatedNotice clears the one-shot "updated from" banner state.
func (m *Manager) DismissUpdatedNotice() {
	m.mu.Lock()
	m.settings.UpdatedFromVersion = ""
	m.state.UpdatedFromVersion = ""
	m.mu.Unlock()
	m.persistSettings()
	m.emit()
}

func (m *Manager) resetOfferLocked() {
	m.release = nil
	m.filePath = ""
	m.state.Status = StatusUpToDate
	m.state.LatestVersion = ""
	m.state.ReleaseTitle = ""
	m.state.ReleaseNotes = ""
	m.state.ReleaseURL = ""
	m.state.PublishedAt = ""
	m.state.AssetName = ""
	m.state.DownloadedBytes = 0
	m.state.TotalBytes = 0
	m.state.Progress = 0
	m.state.PendingRestart = false
	m.state.BusyReasons = nil
	m.state.ErrorMessage = ""
}

// SetWaitingIdle marks a deferred restart with the reasons the app is still busy.
func (m *Manager) SetWaitingIdle(reasons []string) {
	m.mu.Lock()
	if m.state.Status == StatusReady || m.state.Status == StatusWaitingIdle {
		m.state.Status = StatusWaitingIdle
		m.state.PendingRestart = true
		m.state.BusyReasons = reasons
	}
	m.mu.Unlock()
	m.emit()
}

// CancelWaiting returns a deferred restart to ready.
func (m *Manager) CancelWaiting() {
	m.mu.Lock()
	if m.state.Status == StatusWaitingIdle {
		m.state.Status = StatusReady
		m.state.PendingRestart = false
		m.state.BusyReasons = nil
	}
	m.mu.Unlock()
	m.emit()
}

// TryBeginInstall atomically transitions ready/waiting_idle -> installing.
// Returns (filePath, true, nil) to the single winner, ("", false, nil) if already installing
// or if fromWaitingOnly is true and status is no longer waiting_idle, or an error if not ready.
func (m *Manager) TryBeginInstall(fromWaitingOnly bool) (string, bool, error) {
	m.mu.Lock()
	if m.state.Status == StatusInstalling {
		m.mu.Unlock()
		return "", false, nil
	}
	if fromWaitingOnly {
		if m.state.Status != StatusWaitingIdle || m.filePath == "" {
			m.mu.Unlock()
			return "", false, nil
		}
	} else {
		if (m.state.Status != StatusReady && m.state.Status != StatusWaitingIdle) || m.filePath == "" {
			m.mu.Unlock()
			return "", false, errors.New("当前没有已就绪的更新安装包")
		}
	}
	path := m.filePath
	m.state.Status = StatusInstalling
	m.state.PendingRestart = false
	m.state.BusyReasons = nil
	m.mu.Unlock()
	m.emit()
	return path, true, nil
}

// RevertInstallingToReady recovers from a failed apply-helper launch so the user can retry.
func (m *Manager) RevertInstallingToReady() {
	m.mu.Lock()
	if m.state.Status == StatusInstalling {
		m.state.Status = StatusReady
		m.state.PendingRestart = false
		m.state.BusyReasons = nil
	}
	m.mu.Unlock()
	m.emit()
}

// IsWaitingIdle reports whether an install is deferred until the app becomes idle.
func (m *Manager) IsWaitingIdle() bool {
	return m.snapshot().Status == StatusWaitingIdle
}

// ReadyFilePath returns the verified installer path when status is ready/waiting_idle.
func (m *Manager) ReadyFilePath() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if (m.state.Status != StatusReady && m.state.Status != StatusWaitingIdle) || m.filePath == "" {
		return "", errors.New("当前没有已就绪的更新安装包")
	}
	return m.filePath, nil
}

// Mode returns the detected install mode.
func (m *Manager) Mode() InstallMode {
	return m.mode
}

// SetTestingOverrides swaps the API endpoint and install mode; test-only seam
// (production code never calls it).
func (m *Manager) SetTestingOverrides(apiBaseURL string, mode InstallMode) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if apiBaseURL != "" {
		m.github.APIBaseURL = apiBaseURL
	}
	if mode != "" {
		m.mode = mode
		m.state.InstallMode = string(mode)
	}
}

func (m *Manager) backgroundCheck() {
	m.mu.Lock()
	enabled := m.settings.AutoCheckEnabled
	status := m.state.Status
	m.mu.Unlock()
	if !enabled {
		return
	}
	// Never disturb an offered, deferred or in-flight update.
	switch status {
	case StatusDownloading, StatusVerifying, StatusReady, StatusWaitingIdle, StatusInstalling:
		return
	}
	_, _ = m.Check(context.Background(), false)
}

// Check runs one check cycle. manual=true surfaces skipped versions and full errors.
func (m *Manager) Check(ctx context.Context, manual bool) (UpdateState, error) {
	if !m.runMu.TryLock() {
		return m.snapshot(), nil
	}
	defer m.runMu.Unlock()

	if ctx == nil {
		ctx = context.Background()
	}

	m.mu.Lock()
	if m.state.Status == StatusWaitingIdle || m.state.Status == StatusInstalling {
		snap := m.state
		m.mu.Unlock()
		return snap, nil
	}
	prevStatus := m.state.Status
	if m.ctx != nil {
		checkCtx, cancel := context.WithCancel(ctx)
		stopLink := context.AfterFunc(m.ctx, cancel)
		defer func() {
			stopLink()
			cancel()
		}()
		ctx = checkCtx
	}
	channel := m.channel
	current := m.currentVersion
	mode := m.mode
	skipped := m.settings.SkippedVersion
	if manual {
		m.state.Status = StatusChecking
		m.state.ErrorMessage = ""
	}
	m.mu.Unlock()
	if manual {
		m.emit()
	}

	release, err := m.github.FetchLatestRelease(ctx, channel, current, mode)
	m.mu.Lock()
	m.state.CheckedAt = time.Now().Format(time.RFC3339)
	m.mu.Unlock()

	if err != nil {
		if manual {
			m.fail(err)
		} else {
			m.restoreSilentStatus(prevStatus)
		}
		return m.snapshot(), err
	}
	if release == nil || (!manual && release.Version == skipped) {
		m.mu.Lock()
		// Keep an existing ready offer only when its verified file is still in place.
		if m.state.LatestVersion != "" && m.filePath != "" && m.release != nil {
			m.state.Status = StatusReady
		} else {
			m.resetOfferLocked()
		}
		m.mu.Unlock()
		m.emit()
		return m.snapshot(), nil
	}

	if err := m.ensureDownloaded(ctx, release); err != nil {
		if manual {
			m.fail(err)
		} else {
			m.restoreSilentStatus(prevStatus)
		}
		return m.snapshot(), err
	}
	return m.snapshot(), nil
}

func (m *Manager) restoreSilentStatus(prevStatus string) {
	targetStatus := prevStatus
	if targetStatus == "" || targetStatus == StatusError {
		targetStatus = StatusIdle
	}
	m.mu.Lock()
	changed := m.state.Status != targetStatus
	m.state.Status = targetStatus
	m.state.DownloadedBytes = 0
	m.state.TotalBytes = 0
	m.state.Progress = 0
	m.mu.Unlock()
	if changed {
		m.emit()
	}
}

func (m *Manager) fail(err error) {
	m.mu.Lock()
	m.state.Status = StatusError
	m.state.ErrorMessage = err.Error()
	m.state.DownloadedBytes = 0
	m.state.TotalBytes = 0
	m.state.Progress = 0
	m.mu.Unlock()
	m.emit()
}

// ensureDownloaded reuses a valid cached file or downloads to .part, verifies SHA-256,
// then atomically renames into place and enters ready.
func (m *Manager) ensureDownloaded(ctx context.Context, release *ReleaseInfo) error {
	if err := os.MkdirAll(m.cacheDir, 0755); err != nil {
		return fmt.Errorf("创建更新缓存目录失败: %w", err)
	}
	target := filepath.Join(m.cacheDir, release.AssetName)

	m.mu.Lock()
	mirror := m.settings.MirrorURL
	m.release = release
	m.state.LatestVersion = release.Version
	m.state.ReleaseTitle = release.Title
	m.state.ReleaseNotes = release.Notes
	m.state.ReleaseURL = release.URL
	m.state.PublishedAt = release.PublishedAt
	m.state.AssetName = release.AssetName
	m.state.TotalBytes = release.AssetSize
	m.state.DownloadedBytes = 0
	m.state.Progress = 0
	m.mu.Unlock()

	// Fetch checksums first: they are mandatory and tiny.
	sums, err := m.fetchChecksums(ctx, ApplyMirror(release.ChecksumURL, mirror))
	if err != nil {
		return err
	}
	expected, ok := sums[release.AssetName]
	if !ok {
		return fmt.Errorf("SHA256SUMS.txt 中缺少 %s 的校验条目，已拒绝更新", release.AssetName)
	}

	if VerifyFileSHA256(target, expected) == nil {
		m.markReady(release, target)
		return nil
	}
	_ = os.Remove(target)

	m.setStatus(StatusDownloading)
	partPath := target + ".part"
	if err := m.downloadToFile(ctx, ApplyMirror(release.AssetURL, mirror), partPath, release.AssetSize); err != nil {
		_ = os.Remove(partPath)
		return err
	}

	m.setStatus(StatusVerifying)
	if err := VerifyFileSHA256(partPath, expected); err != nil {
		_ = os.Remove(partPath)
		return err
	}
	if err := os.Rename(partPath, target); err != nil {
		_ = os.Remove(partPath)
		return fmt.Errorf("保存更新安装包失败: %w", err)
	}
	m.markReady(release, target)
	return nil
}

func (m *Manager) markReady(release *ReleaseInfo, path string) {
	m.mu.Lock()
	m.filePath = path
	m.state.Status = StatusReady
	m.state.PendingRestart = false
	m.state.BusyReasons = nil
	m.state.ErrorMessage = ""
	if m.state.TotalBytes > 0 {
		m.state.DownloadedBytes = m.state.TotalBytes
		m.state.Progress = 100
	}
	m.mu.Unlock()
	m.emit()
}

func (m *Manager) fetchChecksums(ctx context.Context, url string) (map[string]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", m.github.UserAgent)
	resp, err := m.downloadClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("下载 SHA256SUMS.txt 失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载 SHA256SUMS.txt 失败: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("读取 SHA256SUMS.txt 失败: %w", err)
	}
	sums := ParseSHA256Sums(string(body))
	if len(sums) == 0 {
		return nil, errors.New("SHA256SUMS.txt 内容为空或格式无效，已拒绝更新")
	}
	return sums, nil
}

func (m *Manager) downloadToFile(ctx context.Context, url, partPath string, total int64) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", m.github.UserAgent)
	resp, err := m.downloadClient.Do(req)
	if err != nil {
		return fmt.Errorf("下载更新失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载更新失败: HTTP %d", resp.StatusCode)
	}
	if total <= 0 && resp.ContentLength > 0 {
		total = resp.ContentLength
		m.mu.Lock()
		m.state.TotalBytes = total
		m.mu.Unlock()
	}

	f, err := os.Create(partPath)
	if err != nil {
		return fmt.Errorf("创建下载临时文件失败: %w", err)
	}
	defer f.Close()

	buf := make([]byte, 128*1024)
	var written int64
	lastEmit := time.Time{}
	lastPct := -1
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := f.Write(buf[:n]); wErr != nil {
				return fmt.Errorf("写入下载文件失败: %w", wErr)
			}
			written += int64(n)
			pct := 0
			if total > 0 {
				pct = int(written * 100 / total)
			}
			if time.Since(lastEmit) >= progressThrottle || pct != lastPct {
				m.mu.Lock()
				m.state.DownloadedBytes = written
				m.state.Progress = pct
				m.mu.Unlock()
				m.emit()
				lastEmit = time.Now()
				lastPct = pct
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return fmt.Errorf("下载更新中断: %w", readErr)
		}
	}
	if err := f.Sync(); err != nil {
		return fmt.Errorf("同步下载文件失败: %w", err)
	}
	m.mu.Lock()
	m.state.DownloadedBytes = written
	if total > 0 {
		m.state.Progress = int(written * 100 / total)
	}
	m.mu.Unlock()
	m.emit()
	return nil
}

// ReleasePageAllowed reports whether rawURL points at this project's GitHub pages.
func ReleasePageAllowed(rawURL string) bool {
	return strings.HasPrefix(rawURL, "https://github.com/"+DefaultOwner+"/"+DefaultRepo+"/") ||
		rawURL == "https://github.com/"+DefaultOwner+"/"+DefaultRepo
}