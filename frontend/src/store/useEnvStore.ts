import { create } from 'zustand';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { api, parseError } from '../services/api';
import {
  AIConfig,
  LogEntry,
  PortConflictCheck,
  PortOverviewSnapshot,
  ProcessState,
  ProjectCommand,
  ProjectRecord,
  ShellConfig,
  ShellEnvironmentInfo,
} from '../types';
import { useAccountStore } from './useAccountStore';

const notify = (type: 'success' | 'error' | 'info', message: string) => {
  useAccountStore.getState().setBanner({ type, message });
};

const COLLAPSED_STORAGE_KEY = 'graviton_env_collapsed_projects';
const LEGACY_COLLAPSED_STORAGE_KEY = 'codetool_env_collapsed_projects';

function loadCollapsedProjects(): Record<string, boolean> {
  try {
    const raw =
      localStorage.getItem(COLLAPSED_STORAGE_KEY) ??
      localStorage.getItem(LEGACY_COLLAPSED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result: Record<string, boolean> = {};
      for (const [key, val] of Object.entries(parsed)) {
        if (val === true) {
          result[key] = true;
        }
      }
      return result;
    }
  } catch {
    // Ignore storage errors
  }
  return {};
}

function saveCollapsedProjects(map: Record<string, boolean>) {
  try {
    const compact: Record<string, boolean> = {};
    for (const [key, val] of Object.entries(map)) {
      if (val) compact[key] = true;
    }
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // Ignore storage errors
  }
}

function insertUnpinnedProjectAtTop(projects: ProjectRecord[], proj: ProjectRecord): ProjectRecord[] {
  const pinned = projects.filter((p) => p.pinned);
  const unpinned = projects.filter((p) => !p.pinned);
  return [...pinned, proj, ...unpinned];
}

let reorderSeq = 0;

export interface PortConflictDialogState {
  open: boolean;
  projectId: string;
  commandId: string;
  projectName: string;
  commandName: string;
  check: PortConflictCheck;
}

interface EnvState {
  projects: ProjectRecord[];
  loading: boolean;
  importing: boolean;
  processStates: Record<string, ProcessState>;
  logsByCmd: Record<string, LogEntry[]>;
  activeLogTarget: { projectId: string; commandId: string } | null;
  rightPaneMode: 'terminal' | 'ports';
  portOverview: PortOverviewSnapshot | null;
  portOverviewLoading: boolean;
  portConflictDialog: PortConflictDialogState | null;
  aiAnalyzingIds: Record<string, boolean>;
  aiConfig: AIConfig | null;
  shellEnv: ShellEnvironmentInfo | null;
  collapsedProjects: Record<string, boolean>;
  initialized: boolean;

  init: () => () => void;
  setRightPaneMode: (mode: 'terminal' | 'ports') => void;
  refreshPortOverview: () => Promise<void>;
  closePortConflictDialog: () => void;
  confirmStartWithOverridePort: (overridePort: number) => Promise<boolean>;
  confirmStopConflictAndStart: () => Promise<boolean>;
  killExternalPortProcess: (pid: number) => Promise<void>;
  openLocalURL: (url: string) => Promise<void>;
  loadProjects: () => Promise<void>;
  selectAndImportProject: () => Promise<void>;
  importProjectByPath: (path: string) => Promise<void>;
  rescanProject: (projectId: string) => Promise<void>;
  analyzeProjectWithAI: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  reorderProjects: (pinnedIDs: string[], unpinnedIDs: string[]) => Promise<void>;
  togglePinProject: (projectId: string) => Promise<void>;
  toggleCollapseProject: (projectId: string) => void;
  setAllProjectsCollapsed: (collapsed: boolean) => void;

  saveCommand: (projectId: string, cmd: ProjectCommand) => Promise<boolean>;
  deleteCommand: (projectId: string, commandId: string) => Promise<void>;
  togglePinCommand: (projectId: string, commandId: string) => Promise<void>;

  startCommand: (projectId: string, commandId: string) => Promise<void>;
  stopCommand: (commandId: string) => Promise<void>;
  restartCommand: (projectId: string, commandId: string) => Promise<void>;

  openLogDrawer: (projectId: string, commandId: string) => Promise<void>;
  closeLogDrawer: () => void;
  clearLogs: (commandId: string) => Promise<void>;

  openCommandInTerminal: (projectId: string, commandId: string) => Promise<void>;
  openProjectFolder: (projectId: string) => Promise<void>;
  openProjectTerminal: (projectId: string) => Promise<void>;
  openProjectInClient: (projectId: string) => Promise<void>;

  loadAIConfig: () => Promise<void>;
  saveAIConfig: (cfg: AIConfig) => Promise<boolean>;
  testAIConfig: (cfg: AIConfig) => Promise<boolean>;

  loadShellEnvironment: () => Promise<void>;
  saveShellConfig: (cfg: ShellConfig) => Promise<boolean>;
  selectGitBashPath: () => Promise<void>;
  resetGitBashPath: () => Promise<void>;
}

export const useEnvStore = create<EnvState>((set, get) => ({
  projects: [],
  loading: false,
  importing: false,
  processStates: {},
  logsByCmd: {},
  activeLogTarget: null,
  rightPaneMode: 'terminal',
  portOverview: null,
  portOverviewLoading: false,
  portConflictDialog: null,
  aiAnalyzingIds: {},
  aiConfig: null,
  shellEnv: null,
  collapsedProjects: loadCollapsedProjects(),
  initialized: false,

  init: () => {
    if (!get().initialized) {
      set({ initialized: true });
      void get().loadProjects();
      void get().loadAIConfig();
      void get().loadShellEnvironment();
      void api.getProcessStates().then((states) => {
        set({ processStates: states });
        void get().refreshPortOverview();
      });
    }

    const offStatus = EventsOn('env:process:status', (state: ProcessState) => {
      if (!state?.commandId) return;
      set((s) => ({
        processStates: {
          ...s.processStates,
          [state.commandId]: state,
        },
      }));
      void get().refreshPortOverview();
    });

    const offLog = EventsOn('env:process:log', (entry: LogEntry) => {
      if (!entry?.commandId) return;
      set((s) => {
        const prev = s.logsByCmd[entry.commandId] || [];
        const next = prev.length >= 1000 ? [...prev.slice(prev.length - 999), entry] : [...prev, entry];
        return {
          logsByCmd: {
            ...s.logsByCmd,
            [entry.commandId]: next,
          },
        };
      });
    });

    const offProjUpdated = EventsOn('env:project:updated', (proj: ProjectRecord) => {
      if (!proj?.id) return;
      set((s) => ({
        projects: s.projects.map((p) => (p.id === proj.id ? proj : p)),
      }));
      void get().refreshPortOverview();
    });

    const offAIStatus = EventsOn('env:project:ai_status', (payload: { projectId: string; analyzing: boolean }) => {
      if (!payload?.projectId) return;
      set((s) => ({
        aiAnalyzingIds: {
          ...s.aiAnalyzingIds,
          [payload.projectId]: Boolean(payload.analyzing),
        },
      }));
    });

    return () => {
      offStatus();
      offLog();
      offProjUpdated();
      offAIStatus();
    };
  },

  setRightPaneMode: (mode: 'terminal' | 'ports') => {
    set({ rightPaneMode: mode });
    if (mode === 'ports') {
      void get().refreshPortOverview();
    }
  },

  refreshPortOverview: async () => {
    set({ portOverviewLoading: true });
    try {
      const snapshot = await api.getProjectPortOverview();
      set({ portOverview: snapshot, portOverviewLoading: false });
    } catch {
      set({ portOverviewLoading: false });
    }
  },

  closePortConflictDialog: () => set({ portConflictDialog: null }),

  confirmStartWithOverridePort: async (overridePort: number) => {
    const dlg = get().portConflictDialog;
    if (!dlg) return false;
    try {
      set((s) => ({
        activeLogTarget:
          s.rightPaneMode === 'ports'
            ? s.activeLogTarget
            : { projectId: dlg.projectId, commandId: dlg.commandId },
        logsByCmd: { ...s.logsByCmd, [dlg.commandId]: [] },
      }));
      await api.startCommandWithPortOverride(dlg.projectId, dlg.commandId, overridePort);
      set({ portConflictDialog: null });
      void get().refreshPortOverview();
      return true;
    } catch (e) {
      notify('error', parseError(e).message);
      return false;
    }
  },

  confirmStopConflictAndStart: async () => {
    const dlg = get().portConflictDialog;
    if (!dlg) return false;
    try {
      set((s) => ({
        activeLogTarget:
          s.rightPaneMode === 'ports'
            ? s.activeLogTarget
            : { projectId: dlg.projectId, commandId: dlg.commandId },
        logsByCmd: { ...s.logsByCmd, [dlg.commandId]: [] },
      }));
      await api.stopConflictAndStartCommand(dlg.projectId, dlg.commandId);
      set({ portConflictDialog: null });
      void get().refreshPortOverview();
      return true;
    } catch (e) {
      notify('error', parseError(e).message);
      return false;
    }
  },

  killExternalPortProcess: async (pid: number) => {
    try {
      await api.killExternalPortProcess(pid);
      notify('success', `已终止外部进程 (PID ${pid})`);
      void get().refreshPortOverview();
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  openLocalURL: async (url: string) => {
    try {
      await api.openLocalURL(url);
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  loadProjects: async () => {
    set({ loading: true });
    try {
      const projects = await api.listProjects();
      set({ projects, loading: false });
      void get().refreshPortOverview();

      const currentTarget = get().activeLogTarget;
      const targetExists =
        currentTarget &&
        projects.some(
          (p) => p.id === currentTarget.projectId && p.commands.some((c) => c.id === currentTarget.commandId)
        );
      if (!targetExists && projects.length > 0) {
        const states = get().processStates;
        let fallback: { projectId: string; commandId: string } | null = null;
        for (const p of projects) {
          for (const c of p.commands) {
            const st = states[c.id]?.status;
            if (st === 'running') {
              fallback = { projectId: p.id, commandId: c.id };
              break;
            }
          }
          if (fallback) break;
        }
        if (!fallback) {
          const firstProj = projects.find((p) => p.commands.length > 0);
          if (firstProj) {
            fallback = { projectId: firstProj.id, commandId: firstProj.commands[0].id };
          }
        }
        if (fallback) {
          void get().openLogDrawer(fallback.projectId, fallback.commandId);
        } else {
          set({ activeLogTarget: null });
        }
      }
    } catch (e) {
      set({ loading: false });
      notify('error', parseError(e).message);
    }
  },

  selectAndImportProject: async () => {
    set({ importing: true });
    try {
      const proj = await api.selectAndImportProject();
      set({ importing: false });
      if (!proj) return;
      set((s) => {
        const exists = s.projects.some((p) => p.id === proj.id);
        return {
          projects: exists
            ? s.projects.map((p) => (p.id === proj.id ? proj : p))
            : insertUnpinnedProjectAtTop(s.projects, proj),
        };
      });
      notify('success', `已导入项目「${proj.name}」，共识别 ${proj.commands.length} 条指令`);
      void get().refreshPortOverview();
    } catch (e) {
      set({ importing: false });
      notify('error', parseError(e).message);
    }
  },

  importProjectByPath: async (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    set({ importing: true });
    try {
      const proj = await api.importProjectByPath(trimmed);
      set((s) => {
        const exists = s.projects.some((p) => p.id === proj.id);
        return {
          importing: false,
          projects: exists
            ? s.projects.map((p) => (p.id === proj.id ? proj : p))
            : insertUnpinnedProjectAtTop(s.projects, proj),
        };
      });
      notify('success', `已导入项目「${proj.name}」，共识别 ${proj.commands.length} 条指令`);
      void get().refreshPortOverview();
    } catch (e) {
      set({ importing: false });
      notify('error', parseError(e).message);
    }
  },

  rescanProject: async (projectId: string) => {
    try {
      const updated = await api.rescanProject(projectId);
      set((s) => ({
        projects: s.projects.map((p) => (p.id === projectId ? updated : p)),
      }));
      notify('success', `已重新扫描「${updated.name}」的本地配置`);
      void get().refreshPortOverview();
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  analyzeProjectWithAI: async (projectId: string) => {
    try {
      const updated = await api.analyzeProjectWithAI(projectId);
      set((s) => ({
        projects: s.projects.map((p) => (p.id === projectId ? updated : p)),
      }));
      notify('success', `AI 已完成「${updated.name}」的指令优化`);
      void get().refreshPortOverview();
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  deleteProject: async (projectId: string) => {
    try {
      await api.deleteProject(projectId);
      set((s) => {
        const nextCollapsed = { ...s.collapsedProjects };
        delete nextCollapsed[projectId];
        saveCollapsedProjects(nextCollapsed);
        return {
          projects: s.projects.filter((p) => p.id !== projectId),
          collapsedProjects: nextCollapsed,
          activeLogTarget: s.activeLogTarget?.projectId === projectId ? null : s.activeLogTarget,
        };
      });
      notify('info', '已移除项目');
      void get().refreshPortOverview();
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  reorderProjects: async (pinnedIDs: string[], unpinnedIDs: string[]) => {
    const prevProjects = get().projects;
    const byId = new Map(prevProjects.map((p) => [p.id, p]));
    const seen = new Set<string>();
    const nextPinned: ProjectRecord[] = [];
    const nextUnpinned: ProjectRecord[] = [];

    for (const id of pinnedIDs) {
      const p = byId.get(id);
      if (p && !seen.has(id)) {
        nextPinned.push(Object.assign(Object.create(Object.getPrototypeOf(p)), p, { pinned: true }));
        seen.add(id);
      }
    }
    for (const id of unpinnedIDs) {
      const p = byId.get(id);
      if (p && !seen.has(id)) {
        nextUnpinned.push(Object.assign(Object.create(Object.getPrototypeOf(p)), p, { pinned: false }));
        seen.add(id);
      }
    }
    for (const p of prevProjects) {
      if (!seen.has(p.id)) {
        if (p.pinned) nextPinned.push(p);
        else nextUnpinned.push(p);
      }
    }

    const optimistic = [...nextPinned, ...nextUnpinned];
    const seq = ++reorderSeq;
    set({ projects: optimistic });

    try {
      const persisted = await api.reorderProjects(
        nextPinned.map((p) => p.id),
        nextUnpinned.map((p) => p.id)
      );
      if (seq === reorderSeq) {
        set({ projects: persisted });
      }
    } catch (e) {
      if (seq === reorderSeq) {
        set({ projects: prevProjects });
      }
      notify('error', parseError(e).message);
    }
  },

  togglePinProject: async (projectId: string) => {
    const projects = get().projects;
    const target = projects.find((p) => p.id === projectId);
    if (!target) return;

    const pinnedIDs = projects.filter((p) => p.pinned && p.id !== projectId).map((p) => p.id);
    const unpinnedIDs = projects.filter((p) => !p.pinned && p.id !== projectId).map((p) => p.id);

    if (target.pinned) {
      // Unpin: move to top of unpinned section
      await get().reorderProjects(pinnedIDs, [projectId, ...unpinnedIDs]);
    } else {
      // Pin: move to top of pinned section
      await get().reorderProjects([projectId, ...pinnedIDs], unpinnedIDs);
    }
  },

  toggleCollapseProject: (projectId: string) => {
    set((s) => {
      const next = {
        ...s.collapsedProjects,
        [projectId]: !s.collapsedProjects[projectId],
      };
      saveCollapsedProjects(next);
      return { collapsedProjects: next };
    });
  },

  setAllProjectsCollapsed: (collapsed: boolean) => {
    set((s) => {
      const next: Record<string, boolean> = {};
      if (collapsed) {
        for (const p of s.projects) {
          next[p.id] = true;
        }
      }
      saveCollapsedProjects(next);
      return { collapsedProjects: next };
    });
  },

  saveCommand: async (projectId: string, cmd: ProjectCommand) => {
    try {
      const updated = await api.saveProjectCommand(projectId, cmd);
      set((s) => ({
        projects: s.projects.map((p) => (p.id === projectId ? updated : p)),
      }));
      notify('success', '指令已保存');
      void get().refreshPortOverview();
      return true;
    } catch (e) {
      notify('error', parseError(e).message);
      return false;
    }
  },

  deleteCommand: async (projectId: string, commandId: string) => {
    try {
      const updated = await api.deleteProjectCommand(projectId, commandId);
      set((s) => {
        const nextLogs = { ...s.logsByCmd };
        delete nextLogs[commandId];
        return {
          projects: s.projects.map((p) => (p.id === projectId ? updated : p)),
          logsByCmd: nextLogs,
          activeLogTarget: s.activeLogTarget?.commandId === commandId ? null : s.activeLogTarget,
        };
      });
      notify('info', '已删除指令');
      void get().refreshPortOverview();
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  togglePinCommand: async (projectId: string, commandId: string) => {
    try {
      const updated = await api.togglePinCommand(projectId, commandId);
      set((s) => ({
        projects: s.projects.map((p) => (p.id === projectId ? updated : p)),
      }));
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  startCommand: async (projectId: string, commandId: string) => {
    try {
      const check = await api.checkCommandPortConflict(projectId, commandId);
      if (check?.hasConflict && check.occupant) {
        const proj = get().projects.find((p) => p.id === projectId);
        const cmd = proj?.commands.find((c) => c.id === commandId);
        set({
          portConflictDialog: {
            open: true,
            projectId,
            commandId,
            projectName: proj?.name || '',
            commandName: cmd?.name || '',
            check,
          },
        });
        return;
      }

      set((s) => ({
        activeLogTarget:
          s.rightPaneMode === 'ports' ? s.activeLogTarget : { projectId, commandId },
        logsByCmd: { ...s.logsByCmd, [commandId]: [] },
      }));
      await api.startCommand(projectId, commandId);
      void get().refreshPortOverview();
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  stopCommand: async (commandId: string) => {
    try {
      await api.stopCommand(commandId);
      void get().refreshPortOverview();
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  restartCommand: async (projectId: string, commandId: string) => {
    try {
      set((s) => ({
        activeLogTarget:
          s.rightPaneMode === 'ports' ? s.activeLogTarget : { projectId, commandId },
        logsByCmd: { ...s.logsByCmd, [commandId]: [] },
      }));
      await api.restartCommand(projectId, commandId);
      void get().refreshPortOverview();
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  openLogDrawer: async (projectId: string, commandId: string) => {
    set({ activeLogTarget: { projectId, commandId }, rightPaneMode: 'terminal' });
    const existing = await api.getCommandLogs(commandId);
    set((s) => ({
      logsByCmd: { ...s.logsByCmd, [commandId]: existing },
    }));
  },

  closeLogDrawer: () => set({ activeLogTarget: null }),

  clearLogs: async (commandId: string) => {
    await api.clearCommandLogs(commandId);
    set((s) => ({
      logsByCmd: { ...s.logsByCmd, [commandId]: [] },
    }));
  },

  openCommandInTerminal: async (projectId: string, commandId: string) => {
    try {
      await api.openCommandInTerminal(projectId, commandId);
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  openProjectFolder: async (projectId: string) => {
    try {
      await api.openProjectFolder(projectId);
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  openProjectTerminal: async (projectId: string) => {
    try {
      await api.openProjectTerminal(projectId);
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  openProjectInClient: async (projectId: string) => {
    try {
      await api.openProjectInClient(projectId);
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  loadAIConfig: async () => {
    try {
      const aiConfig = await api.getAIConfig();
      set({ aiConfig });
    } catch {
      // Ignore
    }
  },

  saveAIConfig: async (cfg: AIConfig) => {
    try {
      await api.saveAIConfig(cfg);
      set({ aiConfig: cfg });
      notify('success', 'AI 助手配置已保存');
      return true;
    } catch (e) {
      notify('error', parseError(e).message);
      return false;
    }
  },

  testAIConfig: async (cfg: AIConfig) => {
    try {
      await api.testAIConfig(cfg);
      notify('success', 'AI 接口连接测试成功');
      return true;
    } catch (e) {
      notify('error', parseError(e).message);
      return false;
    }
  },

  loadShellEnvironment: async () => {
    try {
      const shellEnv = await api.getShellEnvironment();
      set({ shellEnv });
    } catch {
      // Ignore
    }
  },

  saveShellConfig: async (cfg: ShellConfig) => {
    try {
      const shellEnv = await api.saveShellConfig(cfg);
      set({ shellEnv });
      notify('success', '默认 Shell 配置已保存');
      return true;
    } catch (e) {
      notify('error', parseError(e).message);
      return false;
    }
  },

  selectGitBashPath: async () => {
    try {
      const selected = await api.selectGitBashPath();
      if (!selected) return;
      await get().loadShellEnvironment();
      notify('success', 'Git Bash 路径已保存');
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  resetGitBashPath: async () => {
    try {
      const shellEnv = await api.resetGitBashPath();
      set({ shellEnv });
      notify('info', '已恢复自动探测 Git Bash');
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },
}));
