package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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
			if prev.Source == "ai" {
				s.Name = prev.Name
				s.Source = "ai"
			}
		}
		out = append(out, s)
	}
	return out
}
