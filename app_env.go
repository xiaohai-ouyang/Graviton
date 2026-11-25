package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"graviton/internal/client"
	"graviton/internal/envmgr"
	"graviton/internal/storage"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ListProjects returns all imported projects from projects.toml.
func (a *App) ListProjects() ([]storage.ProjectRecord, error) {
	if a.storageMgr == nil {
		return []storage.ProjectRecord{}, nil
	}
	a.projectsMu.Lock()
	defer a.projectsMu.Unlock()
	projects, _, err := a.storageMgr.LoadProjects()
	if err != nil {
		return nil, err
	}
	return normalizeProjectOrder(projects), nil
}

// SelectAndImportProject opens a directory picker, scans the selected project, saves it,
// and optionally runs AI refinement in the background if configured.
func (a *App) SelectAndImportProject() (*storage.ProjectRecord, error) {
	if a.ctx == nil {
		return nil, errors.New("应用上下文未就绪")
	}
	selected, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择要导入的项目根目录",
	})
	if err != nil {
		return nil, fmt.Errorf("打开文件夹选择器失败: %w", err)
	}
	if strings.TrimSpace(selected) == "" {
		return nil, nil
	}
	return a.ImportProjectByPath(selected)
}

// ImportProjectByPath scans a local project directory, persists it, and triggers async AI refinement if enabled.
func (a *App) ImportProjectByPath(dirPath string) (*storage.ProjectRecord, error) {
	if a.storageMgr == nil {
		return nil, errors.New("存储管理器未初始化")
	}
	absPath, err := filepath.Abs(strings.TrimSpace(dirPath))
	if err != nil {
		return nil, fmt.Errorf("无效的项目路径: %w", err)
	}

	shellCfg := envmgr.LoadShellConfig(a.storageMgr)
	scanRes, err := envmgr.ScanProjectForShell(absPath, shellCfg.DefaultShell)
	if err != nil {
		return nil, fmt.Errorf("扫描项目目录失败: %w", err)
	}

	nowStr := time.Now().UTC().Format(time.RFC3339)

	a.projectsMu.Lock()
	projects, _, err := a.storageMgr.LoadProjects()
	if err != nil {
		a.projectsMu.Unlock()
		return nil, err
	}

	// If project path already exists, update it instead of duplicating
	var saved storage.ProjectRecord
	foundIdx := -1
	for i, p := range projects {
		if strings.EqualFold(filepath.Clean(p.Path), filepath.Clean(absPath)) {
			foundIdx = i
			break
		}
	}

	if foundIdx >= 0 {
		existing := projects[foundIdx]
		existing.Name = scanRes.Name
		existing.TechStack = scanRes.TechStack
		existing.Commands = mergeRuleScanWithExisting(existing.Commands, scanRes.Commands)
		existing.UpdatedAt = nowStr
		projects[foundIdx] = existing
		saved = existing
	} else {
		saved = storage.ProjectRecord{
			ID:        uuid.NewString(),
			Name:      scanRes.Name,
			Path:      absPath,
			TechStack: scanRes.TechStack,
			Commands:  scanRes.Commands,
			CreatedAt: nowStr,
			UpdatedAt: nowStr,
		}
		projects = insertUnpinnedAtTop(projects, saved)
	}

	if err := a.storageMgr.SaveProjects(projects); err != nil {
		a.projectsMu.Unlock()
		return nil, err
	}
	a.projectsMu.Unlock()

	// Trigger background AI enhancement if configured
	aiCfg := envmgr.LoadAIConfig(a.storageMgr)
	if aiCfg.IsReady() {
		go func(projID string) {
			ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
			defer cancel()
			_, _ = a.AnalyzeProjectWithAI(projID)
			_ = ctx
		}(saved.ID)
	}

	return &saved, nil
}

// RescanProject re-runs the local static rule scanner on an imported project while preserving manual commands.
func (a *App) RescanProject(projectID string) (*storage.ProjectRecord, error) {
	if a.storageMgr == nil {
		return nil, errors.New("存储管理器未初始化")
	}

	a.projectsMu.Lock()
	projects, _, err := a.storageMgr.LoadProjects()
	if err != nil {
		a.projectsMu.Unlock()
		return nil, err
	}

	idx := findProjectIndex(projects, projectID)
	if idx < 0 {
		a.projectsMu.Unlock()
		return nil, errors.New("未找到该项目")
	}
	proj := projects[idx]
	a.projectsMu.Unlock()

	shellCfg := envmgr.LoadShellConfig(a.storageMgr)
	scanRes, err := envmgr.ScanProjectForShell(proj.Path, shellCfg.DefaultShell)
	if err != nil {
		return nil, fmt.Errorf("重新扫描项目失败: %w", err)
	}

	a.projectsMu.Lock()
	defer a.projectsMu.Unlock()
	projects, _, err = a.storageMgr.LoadProjects()
	if err != nil {
		return nil, err
	}
	idx = findProjectIndex(projects, projectID)
	if idx < 0 {
		return nil, errors.New("未找到该项目")
	}
	projects[idx].TechStack = scanRes.TechStack
	projects[idx].Commands = mergeRuleScanWithExisting(projects[idx].Commands, scanRes.Commands)
	projects[idx].UpdatedAt = time.Now().UTC().Format(time.RFC3339)

	if err := a.storageMgr.SaveProjects(projects); err != nil {
		return nil, err
	}
	updated := projects[idx]
	return &updated, nil
}

// AnalyzeProjectWithAI uses the configured lightweight OpenAI-compatible model to refine commands & names.
func (a *App) AnalyzeProjectWithAI(projectID string) (*storage.ProjectRecord, error) {
	if a.storageMgr == nil {
		return nil, errors.New("存储管理器未初始化")
	}
	aiCfg := envmgr.LoadAIConfig(a.storageMgr)
	if !aiCfg.IsReady() {
		return nil, errors.New("AI 辅助未启用或配置不完整，请先在「设置」页配置")
	}

	a.projectsMu.Lock()
	projects, _, err := a.storageMgr.LoadProjects()
	if err != nil {
		a.projectsMu.Unlock()
		return nil, err
	}
	idx := findProjectIndex(projects, projectID)
	if idx < 0 {
		a.projectsMu.Unlock()
		return nil, errors.New("未找到该项目")
	}
	projSnapshot := projects[idx]
	a.projectsMu.Unlock()

	if a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "env:project:ai_status", map[string]any{
			"projectId": projectID,
			"analyzing": true,
		})
		defer runtime.EventsEmit(a.ctx, "env:project:ai_status", map[string]any{
			"projectId": projectID,
			"analyzing": false,
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancel()

	shellCfg := envmgr.LoadShellConfig(a.storageMgr)
	refined, err := envmgr.AnalyzeProjectWithAI(ctx, aiCfg, projSnapshot, shellCfg.DefaultShell)
	if err != nil {
		return nil, err
	}

	a.projectsMu.Lock()
	defer a.projectsMu.Unlock()
	projects, _, err = a.storageMgr.LoadProjects()
	if err != nil {
		return nil, err
	}
	idx = findProjectIndex(projects, projectID)
	if idx < 0 {
		return nil, errors.New("未找到该项目")
	}
	projects[idx].Commands = refined
	projects[idx].AIAnalyzed = true
	projects[idx].UpdatedAt = time.Now().UTC().Format(time.RFC3339)

	if err := a.storageMgr.SaveProjects(projects); err != nil {
		return nil, err
	}
	updated := projects[idx]

	if a.ctx != nil && !a.isWidget {
		runtime.EventsEmit(a.ctx, "env:project:updated", updated)
	}
	return &updated, nil
}

// ReorderProjects updates the display order and pinned state of projects atomically.
func (a *App) ReorderProjects(pinnedIDs, unpinnedIDs []string) ([]storage.ProjectRecord, error) {
	if a.storageMgr == nil {
		return nil, errors.New("存储管理器未初始化")
	}

	a.projectsMu.Lock()
	defer a.projectsMu.Unlock()

	projects, _, err := a.storageMgr.LoadProjects()
	if err != nil {
		return nil, err
	}

	byID := make(map[string]storage.ProjectRecord, len(projects))
	for _, p := range projects {
		byID[p.ID] = p
	}

	seen := make(map[string]bool, len(projects))
	pinnedList := make([]storage.ProjectRecord, 0, len(pinnedIDs))
	for _, id := range pinnedIDs {
		if seen[id] {
			continue
		}
		if p, ok := byID[id]; ok {
			p.Pinned = true
			pinnedList = append(pinnedList, p)
			seen[id] = true
		}
	}

	unpinnedList := make([]storage.ProjectRecord, 0, len(unpinnedIDs))
	for _, id := range unpinnedIDs {
		if seen[id] {
			continue
		}
		if p, ok := byID[id]; ok {
			p.Pinned = false
			unpinnedList = append(unpinnedList, p)
			seen[id] = true
		}
	}

	// Preserve any projects not included in either ID slice (e.g. concurrent imports).
	for _, p := range projects {
		if seen[p.ID] {
			continue
		}
		if p.Pinned {
			pinnedList = append(pinnedList, p)
		} else {
			unpinnedList = append(unpinnedList, p)
		}
	}

	reordered := append(pinnedList, unpinnedList...)
	if err := a.storageMgr.SaveProjects(reordered); err != nil {
		return nil, err
	}
	return reordered, nil
}

// DeleteProject removes a project and stops any running commands belonging to it.
func (a *App) DeleteProject(projectID string) error {
	if a.storageMgr == nil {
		return errors.New("存储管理器未初始化")
	}

	a.projectsMu.Lock()
	projects, _, err := a.storageMgr.LoadProjects()
	if err != nil {
		a.projectsMu.Unlock()
		return err
	}
	idx := findProjectIndex(projects, projectID)
	if idx < 0 {
		a.projectsMu.Unlock()
		return nil
	}
	cmdIDs := make([]string, 0, len(projects[idx].Commands))
	for _, c := range projects[idx].Commands {
		cmdIDs = append(cmdIDs, c.ID)
	}
	projects = append(projects[:idx], projects[idx+1:]...)
	err = a.storageMgr.SaveProjects(projects)
	a.projectsMu.Unlock()

	if a.procMgr != nil {
		for _, id := range cmdIDs {
			_ = a.procMgr.StopCommand(id)
		}
	}
	return err
}

// SaveProjectCommand creates or updates a command within a project.
func (a *App) SaveProjectCommand(projectID string, cmd storage.ProjectCommand) (*storage.ProjectRecord, error) {
	if a.storageMgr == nil {
		return nil, errors.New("存储管理器未初始化")
	}
	if strings.TrimSpace(cmd.Name) == "" || strings.TrimSpace(cmd.Command) == "" {
		return nil, errors.New("指令名称和命令内容不能为空")
	}
	if cmd.ExpectedPort < 0 || cmd.ExpectedPort > 65535 {
		return nil, errors.New("预期端口必须在 1~65535 之间")
	}

	a.projectsMu.Lock()
	defer a.projectsMu.Unlock()
	projects, _, err := a.storageMgr.LoadProjects()
	if err != nil {
		return nil, err
	}
	idx := findProjectIndex(projects, projectID)
	if idx < 0 {
		return nil, errors.New("未找到该项目")
	}

	cmd.Name = strings.TrimSpace(cmd.Name)
	cmd.Command = envmgr.NormalizeCommandText(cmd.Command)
	cmd.Cwd = strings.TrimSpace(cmd.Cwd)
	cmd.Shell = envmgr.NormalizeShellOverride(cmd.Shell)
	if cmd.Category == "" {
		cmd.Category = "other"
	}
	if cmd.Source == "" {
		cmd.Source = "manual"
	}

	if cmd.ID == "" {
		cmd.ID = uuid.NewString()
		cmd.Source = "manual"
		projects[idx].Commands = append([]storage.ProjectCommand{cmd}, projects[idx].Commands...)
	} else {
		updated := false
		for i, existing := range projects[idx].Commands {
			if existing.ID == cmd.ID {
				cmd.Source = "manual"
				projects[idx].Commands[i] = cmd
				updated = true
				break
			}
		}
		if !updated {
			cmd.Source = "manual"
			projects[idx].Commands = append([]storage.ProjectCommand{cmd}, projects[idx].Commands...)
		}
	}

	projects[idx].UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := a.storageMgr.SaveProjects(projects); err != nil {
		return nil, err
	}
	out := projects[idx]
	return &out, nil
}

// DeleteProjectCommand removes a command from a project and stops it if running.
func (a *App) DeleteProjectCommand(projectID, commandID string) (*storage.ProjectRecord, error) {
	if a.storageMgr == nil {
		return nil, errors.New("存储管理器未初始化")
	}
	if a.procMgr != nil {
		_ = a.procMgr.StopCommand(commandID)
	}

	a.projectsMu.Lock()
	defer a.projectsMu.Unlock()
	projects, _, err := a.storageMgr.LoadProjects()
	if err != nil {
		return nil, err
	}
	idx := findProjectIndex(projects, projectID)
	if idx < 0 {
		return nil, errors.New("未找到该项目")
	}

	filtered := make([]storage.ProjectCommand, 0, len(projects[idx].Commands))
	for _, c := range projects[idx].Commands {
		if c.ID != commandID {
			filtered = append(filtered, c)
		}
	}
	projects[idx].Commands = filtered
	projects[idx].UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := a.storageMgr.SaveProjects(projects); err != nil {
		return nil, err
	}
	out := projects[idx]
	return &out, nil
}

// TogglePinCommand toggles whether a command is pinned as a core command on the project card.
func (a *App) TogglePinCommand(projectID, commandID string) (*storage.ProjectRecord, error) {
	if a.storageMgr == nil {
		return nil, errors.New("存储管理器未初始化")
	}
	a.projectsMu.Lock()
	defer a.projectsMu.Unlock()
	projects, _, err := a.storageMgr.LoadProjects()
	if err != nil {
		return nil, err
	}
	idx := findProjectIndex(projects, projectID)
	if idx < 0 {
		return nil, errors.New("未找到该项目")
	}
	for i := range projects[idx].Commands {
		if projects[idx].Commands[i].ID == commandID {
			projects[idx].Commands[i].Pinned = !projects[idx].Commands[i].Pinned
			break
		}
	}
	projects[idx].UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if err := a.storageMgr.SaveProjects(projects); err != nil {
		return nil, err
	}
	out := projects[idx]
	return &out, nil
}

// StartCommand starts a managed process for the given project command.
func (a *App) StartCommand(projectID, commandID string) error {
	if a.procMgr == nil {
		return errors.New("进程管理器未初始化")
	}
	proj, cmd, err := a.findProjectAndCommand(projectID, commandID)
	if err != nil {
		return err
	}
	shellCfg := envmgr.LoadShellConfig(a.storageMgr)
	return a.procMgr.StartCommand(proj.ID, cmd.ID, proj.Path, cmd.Cwd, cmd.Command, cmd.Shell, shellCfg)
}

// StartCommandWithPortOverride launches a command with a temporary alternate port without modifying saved config.
func (a *App) StartCommandWithPortOverride(projectID, commandID string, overridePort int) error {
	if a.procMgr == nil {
		return errors.New("进程管理器未初始化")
	}
	if overridePort < 1 || overridePort > 65535 {
		return errors.New("新端口必须在 1~65535 之间")
	}
	proj, cmd, err := a.findProjectAndCommand(projectID, commandID)
	if err != nil {
		return err
	}
	shellCfg := envmgr.LoadShellConfig(a.storageMgr)
	return a.procMgr.StartCommandWithOptions(envmgr.StartOptions{
		ProjectID:    proj.ID,
		CommandID:    cmd.ID,
		ProjectRoot:  proj.Path,
		Cwd:          cmd.Cwd,
		CommandLine:  cmd.Command,
		Shell:        cmd.Shell,
		ShellCfg:     shellCfg,
		OverridePort: overridePort,
	})
}

// CheckCommandPortConflict inspects whether a command's expected port is currently occupied on this machine.
func (a *App) CheckCommandPortConflict(projectID, commandID string) (envmgr.PortConflictCheck, error) {
	_, cmd, err := a.findProjectAndCommand(projectID, commandID)
	if err != nil {
		return envmgr.PortConflictCheck{}, err
	}
	if cmd.ExpectedPort < 1 || cmd.ExpectedPort > 65535 {
		return envmgr.PortConflictCheck{HasConflict: false}, nil
	}

	projects, _ := a.ListProjects()
	occ := a.findPortOccupant(cmd.ExpectedPort, commandID, projects, nil)
	if occ == nil {
		return envmgr.PortConflictCheck{HasConflict: false, Port: cmd.ExpectedPort}, nil
	}

	return envmgr.PortConflictCheck{
		HasConflict:   true,
		Port:          cmd.ExpectedPort,
		SuggestedPort: envmgr.FindAvailablePort(cmd.ExpectedPort),
		Occupant:      occ,
	}, nil
}

// StopConflictAndStartCommand stops the process occupying a command's expected port and then starts the command.
func (a *App) StopConflictAndStartCommand(projectID, commandID string) error {
	if a.procMgr == nil {
		return errors.New("进程管理器未初始化")
	}
	_, cmd, err := a.findProjectAndCommand(projectID, commandID)
	if err != nil {
		return err
	}

	if cmd.ExpectedPort >= 1 && cmd.ExpectedPort <= 65535 {
		projects, _ := a.ListProjects()
		if occ := a.findPortOccupant(cmd.ExpectedPort, commandID, projects, nil); occ != nil {
			if occ.IsManaged && occ.CommandID != "" {
				if stopErr := a.procMgr.StopCommand(occ.CommandID); stopErr != nil {
					return fmt.Errorf("停止冲突指令失败: %w", stopErr)
				}
			} else if occ.PID > 0 {
				if killErr := envmgr.KillExternalProcess(occ.PID); killErr != nil {
					return killErr
				}
			}

			// Wait briefly for the OS to release the TCP listening socket
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				if a.findPortOccupant(cmd.ExpectedPort, commandID, projects, nil) == nil {
					break
				}
				time.Sleep(150 * time.Millisecond)
			}
			if still := a.findPortOccupant(cmd.ExpectedPort, commandID, projects, nil); still != nil {
				return fmt.Errorf("端口 %d 仍被 %s (PID %d) 占用，无法释放", cmd.ExpectedPort, still.ProcessName, still.PID)
			}
		}
	}

	return a.StartCommand(projectID, commandID)
}

// GetProjectPortOverview returns a focused port snapshot covering only imported projects and conflicting external listeners.
func (a *App) GetProjectPortOverview() (envmgr.PortOverviewSnapshot, error) {
	projects, err := a.ListProjects()
	if err != nil {
		return envmgr.PortOverviewSnapshot{Entries: []envmgr.ProjectPortEntry{}}, err
	}

	var listeners []envmgr.TCPListener
	var states map[string]envmgr.ProcessState
	var managedPIDs map[int]envmgr.ProcessState

	if a.procMgr != nil {
		listeners = a.procMgr.RefreshLivePortsNow()
		states = a.procMgr.GetStates()
		managedPIDs = a.procMgr.GetManagedPIDMap()
	} else {
		listeners, _ = envmgr.ListListeningTCPSockets()
		states = map[string]envmgr.ProcessState{}
		managedPIDs = map[int]envmgr.ProcessState{}
	}

	listenersByPort := make(map[int][]envmgr.TCPListener)
	for _, l := range listeners {
		listenersByPort[l.Port] = append(listenersByPort[l.Port], l)
	}

	entries := make([]envmgr.ProjectPortEntry, 0)
	cmdIDsByPort := make(map[int]map[string]bool)
	recordPortCmd := func(port int, cmdID string) {
		if cmdIDsByPort[port] == nil {
			cmdIDsByPort[port] = make(map[string]bool)
		}
		cmdIDsByPort[port][cmdID] = true
	}

	runningCount := 0

	for _, proj := range projects {
		for _, cmd := range proj.Commands {
			st := states[cmd.ID]
			if st.Status == envmgr.StatusRunning {
				if len(st.Ports) > 0 {
					for _, lp := range st.Ports {
						runningCount++
						recordPortCmd(lp.Port, cmd.ID)
						entries = append(entries, envmgr.ProjectPortEntry{
							Port:         lp.Port,
							State:        "running",
							URL:          lp.URL,
							Scheme:       lp.Scheme,
							ProjectID:    proj.ID,
							ProjectName:  proj.Name,
							CommandID:    cmd.ID,
							CommandName:  cmd.Name,
							Cwd:          cmd.Cwd,
							PID:          lp.PID,
							ProcessName:  lp.Process,
							OverridePort: st.OverridePort,
							ExpectedPort: cmd.ExpectedPort,
						})
					}
					continue
				}
				// Running but not yet listening: show expected/override port if known
				fallbackPort := st.OverridePort
				if fallbackPort <= 0 {
					fallbackPort = cmd.ExpectedPort
				}
				if fallbackPort > 0 {
					recordPortCmd(fallbackPort, cmd.ID)
					entries = append(entries, envmgr.ProjectPortEntry{
						Port:         fallbackPort,
						State:        "expected",
						URL:          envmgr.BuildLocalURL("http", fallbackPort),
						Scheme:       "http",
						ProjectID:    proj.ID,
						ProjectName:  proj.Name,
						CommandID:    cmd.ID,
						CommandName:  cmd.Name,
						Cwd:          cmd.Cwd,
						PID:          st.PID,
						OverridePort: st.OverridePort,
						ExpectedPort: cmd.ExpectedPort,
					})
				}
				continue
			}

			if cmd.ExpectedPort > 0 {
				recordPortCmd(cmd.ExpectedPort, cmd.ID)
				entries = append(entries, envmgr.ProjectPortEntry{
					Port:         cmd.ExpectedPort,
					State:        "expected",
					URL:          envmgr.BuildLocalURL("http", cmd.ExpectedPort),
					Scheme:       "http",
					ProjectID:    proj.ID,
					ProjectName:  proj.Name,
					CommandID:    cmd.ID,
					CommandName:  cmd.Name,
					Cwd:          cmd.Cwd,
					ExpectedPort: cmd.ExpectedPort,
				})
			}
		}
	}

	// Mark static/shared port clashes and external process clashes
	conflictPorts := make(map[int]bool)
	for i := range entries {
		e := &entries[i]
		if len(cmdIDsByPort[e.Port]) > 1 {
			e.StaticClash = true
			conflictPorts[e.Port] = true
		}

		// Find any external (non-managed) listener occupying this port
		for _, l := range listenersByPort[e.Port] {
			if _, isManaged := managedPIDs[l.PID]; isManaged {
				continue
			}
			e.ExternalClash = &envmgr.PortOccupant{
				Port:        l.Port,
				Address:     l.Address,
				PID:         l.PID,
				ProcessName: l.ProcessName,
				IsManaged:   false,
			}
			conflictPorts[e.Port] = true
			break
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		ci := entries[i].StaticClash || entries[i].ExternalClash != nil
		cj := entries[j].StaticClash || entries[j].ExternalClash != nil
		if ci != cj {
			return ci
		}
		ri := entries[i].State == "running"
		rj := entries[j].State == "running"
		if ri != rj {
			return ri
		}
		if entries[i].Port != entries[j].Port {
			return entries[i].Port < entries[j].Port
		}
		if entries[i].ProjectName != entries[j].ProjectName {
			return entries[i].ProjectName < entries[j].ProjectName
		}
		return entries[i].CommandName < entries[j].CommandName
	})

	return envmgr.PortOverviewSnapshot{
		Entries:       entries,
		ConflictCount: len(conflictPorts),
		RunningCount:  runningCount,
	}, nil
}

// KillExternalPortProcess terminates a non-managed local process occupying a conflicting port.
func (a *App) KillExternalPortProcess(pid int) error {
	return envmgr.KillExternalProcess(pid)
}

// OpenLocalURL opens a validated localhost HTTP(S) URL in the default browser.
func (a *App) OpenLocalURL(rawURL string) error {
	safeURL, err := envmgr.ValidateLocalURL(rawURL)
	if err != nil {
		return err
	}
	if a.ctx == nil {
		return errors.New("应用上下文未就绪")
	}
	runtime.BrowserOpenURL(a.ctx, safeURL)
	return nil
}

func (a *App) findPortOccupant(port int, ignoreCommandID string, projects []storage.ProjectRecord, cachedListeners []envmgr.TCPListener) *envmgr.PortOccupant {
	if port < 1 || port > 65535 {
		return nil
	}

	listeners := cachedListeners
	if listeners == nil {
		if a.procMgr != nil {
			listeners = a.procMgr.RefreshLivePortsNow()
		} else {
			listeners, _ = envmgr.ListListeningTCPSockets()
		}
	}

	managedPIDs := map[int]envmgr.ProcessState{}
	if a.procMgr != nil {
		managedPIDs = a.procMgr.GetManagedPIDMap()
	}

	projNames := make(map[string]string, len(projects))
	cmdNames := make(map[string]string)
	for _, p := range projects {
		projNames[p.ID] = p.Name
		for _, c := range p.Commands {
			cmdNames[c.ID] = c.Name
		}
	}

	// First check managed states directly (in case of log-supplemented port)
	if a.procMgr != nil {
		for cmdID, st := range a.procMgr.GetStates() {
			if cmdID == ignoreCommandID || st.Status != envmgr.StatusRunning {
				continue
			}
			for _, lp := range st.Ports {
				if lp.Port == port {
					return &envmgr.PortOccupant{
						Port:        port,
						Address:     lp.Address,
						PID:         lp.PID,
						ProcessName: lp.Process,
						IsManaged:   true,
						ProjectID:   st.ProjectID,
						ProjectName: projNames[st.ProjectID],
						CommandID:   st.CommandID,
						CommandName: cmdNames[st.CommandID],
					}
				}
			}
		}
	}

	for _, l := range listeners {
		if l.Port != port {
			continue
		}
		if st, ok := managedPIDs[l.PID]; ok {
			if st.CommandID == ignoreCommandID {
				continue
			}
			return &envmgr.PortOccupant{
				Port:        port,
				Address:     l.Address,
				PID:         l.PID,
				ProcessName: l.ProcessName,
				IsManaged:   true,
				ProjectID:   st.ProjectID,
				ProjectName: projNames[st.ProjectID],
				CommandID:   st.CommandID,
				CommandName: cmdNames[st.CommandID],
			}
		}
		return &envmgr.PortOccupant{
			Port:        port,
			Address:     l.Address,
			PID:         l.PID,
			ProcessName: l.ProcessName,
			IsManaged:   false,
		}
	}
	return nil
}

// StopCommand stops a running managed process tree.
func (a *App) StopCommand(commandID string) error {
	if a.procMgr == nil {
		return nil
	}
	return a.procMgr.StopCommand(commandID)
}

// RestartCommand stops and starts a project command.
func (a *App) RestartCommand(projectID, commandID string) error {
	if a.procMgr == nil {
		return errors.New("进程管理器未初始化")
	}
	_ = a.procMgr.StopCommand(commandID)
	return a.StartCommand(projectID, commandID)
}

// GetProcessStates returns all tracked process states.
func (a *App) GetProcessStates() map[string]envmgr.ProcessState {
	if a.procMgr == nil {
		return map[string]envmgr.ProcessState{}
	}
	return a.procMgr.GetStates()
}

// GetCommandLogs returns buffered logs for a command.
func (a *App) GetCommandLogs(commandID string) []envmgr.LogEntry {
	if a.procMgr == nil {
		return []envmgr.LogEntry{}
	}
	return a.procMgr.GetLogs(commandID)
}

// ClearCommandLogs clears buffered logs for a command.
func (a *App) ClearCommandLogs(commandID string) {
	if a.procMgr != nil {
		a.procMgr.ClearLogs(commandID)
	}
}

// OpenCommandInTerminal launches an external terminal running the command in its cwd.
func (a *App) OpenCommandInTerminal(projectID, commandID string) error {
	proj, cmd, err := a.findProjectAndCommand(projectID, commandID)
	if err != nil {
		return err
	}
	dir := envmgr.ResolveCwd(proj.Path, cmd.Cwd)
	shellCfg := envmgr.LoadShellConfig(a.storageMgr)
	return envmgr.OpenInExternalTerminal(dir, cmd.Command, cmd.Shell, shellCfg)
}

// OpenProjectFolder opens the project root directory in Explorer.
func (a *App) OpenProjectFolder(projectID string) error {
	proj, err := a.findProject(projectID)
	if err != nil {
		return err
	}
	return envmgr.OpenFolder(proj.Path)
}

// OpenProjectTerminal opens an external terminal at the project root directory.
func (a *App) OpenProjectTerminal(projectID string) error {
	proj, err := a.findProject(projectID)
	if err != nil {
		return err
	}
	shellCfg := envmgr.LoadShellConfig(a.storageMgr)
	return envmgr.OpenInExternalTerminal(proj.Path, "", "", shellCfg)
}

// OpenProjectInClient launches Antigravity (or configured client) with the project directory.
func (a *App) OpenProjectInClient(projectID string) error {
	proj, err := a.findProject(projectID)
	if err != nil {
		return err
	}
	override := ""
	if a.service != nil {
		override = a.service.GetClientPath()
	}
	exePath, err := client.DetectClientPath(override)
	if err != nil {
		return fmt.Errorf("未检测到客户端路径，请在「设置」页手动指定: %w", err)
	}
	return envmgr.OpenInClient(exePath, proj.Path)
}

// GetAIConfig returns the current OpenAI-compatible AI configuration.
func (a *App) GetAIConfig() envmgr.AIConfig {
	return envmgr.LoadAIConfig(a.storageMgr)
}

// SaveAIConfig saves the OpenAI-compatible AI configuration.
func (a *App) SaveAIConfig(cfg envmgr.AIConfig) error {
	return envmgr.SaveAIConfig(a.storageMgr, cfg)
}

// TestAIConfig tests connectivity to the configured OpenAI-compatible endpoint.
func (a *App) TestAIConfig(cfg envmgr.AIConfig) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return envmgr.TestAIConfig(ctx, cfg)
}

// GetShellEnvironment returns the global shell preferences and detected shell runtimes.
func (a *App) GetShellEnvironment() envmgr.ShellEnvironmentInfo {
	return envmgr.GetShellEnvironment(a.storageMgr)
}

// SaveShellConfig saves the global shell preferences and returns the refreshed runtime info.
func (a *App) SaveShellConfig(cfg envmgr.ShellConfig) (envmgr.ShellEnvironmentInfo, error) {
	if a.storageMgr == nil {
		return envmgr.ShellEnvironmentInfo{}, errors.New("存储管理器未初始化")
	}
	if err := envmgr.SaveShellConfig(a.storageMgr, cfg); err != nil {
		return envmgr.ShellEnvironmentInfo{}, err
	}
	return envmgr.GetShellEnvironment(a.storageMgr), nil
}

// SelectGitBashPath opens a native file dialog to choose bash.exe, validates and saves it.
func (a *App) SelectGitBashPath() (string, error) {
	if a.ctx == nil {
		return "", errors.New("应用上下文未就绪")
	}
	if a.storageMgr == nil {
		return "", errors.New("存储管理器未初始化")
	}
	selected, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择 Git Bash 可执行文件 (bash.exe)",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "可执行文件 (*.exe)",
				Pattern:     "*.exe",
			},
		},
	})
	if err != nil {
		return "", fmt.Errorf("打开文件选择器失败: %w", err)
	}
	if strings.TrimSpace(selected) == "" {
		return "", nil
	}
	info, statErr := os.Stat(selected)
	if statErr != nil || info.IsDir() {
		return "", errors.New("所选文件不存在或不是有效的可执行文件")
	}
	cfg := envmgr.LoadShellConfig(a.storageMgr)
	cfg.GitBashPath = selected
	if err := envmgr.SaveShellConfig(a.storageMgr, cfg); err != nil {
		return "", fmt.Errorf("保存 Git Bash 路径设置失败: %w", err)
	}
	return selected, nil
}

// ResetGitBashPath clears the manual Git Bash path override so automatic detection is used.
func (a *App) ResetGitBashPath() (envmgr.ShellEnvironmentInfo, error) {
	if a.storageMgr == nil {
		return envmgr.ShellEnvironmentInfo{}, errors.New("存储管理器未初始化")
	}
	cfg := envmgr.LoadShellConfig(a.storageMgr)
	cfg.GitBashPath = ""
	if err := envmgr.SaveShellConfig(a.storageMgr, cfg); err != nil {
		return envmgr.ShellEnvironmentInfo{}, err
	}
	return envmgr.GetShellEnvironment(a.storageMgr), nil
}

func (a *App) findProject(projectID string) (*storage.ProjectRecord, error) {
	if a.storageMgr == nil {
		return nil, errors.New("存储管理器未初始化")
	}
	a.projectsMu.Lock()
	defer a.projectsMu.Unlock()
	projects, _, err := a.storageMgr.LoadProjects()
	if err != nil {
		return nil, err
	}
	idx := findProjectIndex(projects, projectID)
	if idx < 0 {
		return nil, errors.New("未找到该项目")
	}
	p := projects[idx]
	return &p, nil
}

func (a *App) findProjectAndCommand(projectID, commandID string) (*storage.ProjectRecord, *storage.ProjectCommand, error) {
	proj, err := a.findProject(projectID)
	if err != nil {
		return nil, nil, err
	}
	for i := range proj.Commands {
		if proj.Commands[i].ID == commandID {
			return proj, &proj.Commands[i], nil
		}
	}
	return nil, nil, errors.New("未找到该指令")
}

func findProjectIndex(projects []storage.ProjectRecord, projectID string) int {
	for i, p := range projects {
		if p.ID == projectID {
			return i
		}
	}
	return -1
}

// normalizeProjectOrder stably partitions projects so pinned items always precede unpinned items.
func normalizeProjectOrder(projects []storage.ProjectRecord) []storage.ProjectRecord {
	if len(projects) <= 1 {
		return projects
	}
	pinned := make([]storage.ProjectRecord, 0, len(projects))
	unpinned := make([]storage.ProjectRecord, 0, len(projects))
	for _, p := range projects {
		if p.Pinned {
			pinned = append(pinned, p)
		} else {
			unpinned = append(unpinned, p)
		}
	}
	return append(pinned, unpinned...)
}

// insertUnpinnedAtTop inserts a newly imported (unpinned) project at the top of the unpinned section.
func insertUnpinnedAtTop(projects []storage.ProjectRecord, proj storage.ProjectRecord) []storage.ProjectRecord {
	proj.Pinned = false
	normalized := normalizeProjectOrder(projects)
	insertIdx := 0
	for insertIdx < len(normalized) && normalized[insertIdx].Pinned {
		insertIdx++
	}
	out := make([]storage.ProjectRecord, 0, len(normalized)+1)
	out = append(out, normalized[:insertIdx]...)
	out = append(out, proj)
	out = append(out, normalized[insertIdx:]...)
	return out
}

// mergeRuleScanWithExisting preserves manual commands and existing command IDs/pins across rescans.
func mergeRuleScanWithExisting(existing, scanned []storage.ProjectCommand) []storage.ProjectCommand {
	existingByKey := make(map[string]storage.ProjectCommand, len(existing))
	for _, c := range existing {
		key := strings.TrimSpace(c.Cwd) + "::" + strings.TrimSpace(c.Command)
		existingByKey[key] = c
	}

	out := make([]storage.ProjectCommand, 0, len(existing)+len(scanned))
	usedKeys := make(map[string]bool)

	for _, c := range existing {
		if c.Source == "manual" {
			key := strings.TrimSpace(c.Cwd) + "::" + strings.TrimSpace(c.Command)
			usedKeys[key] = true
			out = append(out, c)
		}
	}

	for _, s := range scanned {
		key := strings.TrimSpace(s.Cwd) + "::" + strings.TrimSpace(s.Command)
		if usedKeys[key] {
			continue
		}
		usedKeys[key] = true
		if prev, ok := existingByKey[key]; ok {
			s.ID = prev.ID
			s.Pinned = prev.Pinned
			s.Shell = prev.Shell
			if s.ExpectedPort <= 0 && prev.ExpectedPort > 0 {
				s.ExpectedPort = prev.ExpectedPort
			}
			if prev.Source == "ai" {
				s.Name = prev.Name
				s.Source = "ai"
			}
		}
		out = append(out, s)
	}
	return out
}
