import { create } from 'zustand';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { api, parseError } from '../services/api';
import { AIConfig, LogEntry, ProcessState, ProjectCommand, ProjectRecord } from '../types';
import { useAccountStore } from './useAccountStore';

const notify = (type: 'success' | 'error' | 'info', message: string) => {
  useAccountStore.getState().setBanner({ type, message });
};

interface EnvState {
  projects: ProjectRecord[];
  loading: boolean;
  importing: boolean;
  processStates: Record<string, ProcessState>;
  logsByCmd: Record<string, LogEntry[]>;
  activeLogTarget: { projectId: string; commandId: string } | null;
  aiAnalyzingIds: Record<string, boolean>;
  aiConfig: AIConfig | null;
  initialized: boolean;

  init: () => () => void;
  loadProjects: () => Promise<void>;
  selectAndImportProject: () => Promise<void>;
  importProjectByPath: (path: string) => Promise<void>;
  rescanProject: (projectId: string) => Promise<void>;
  analyzeProjectWithAI: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;

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
}

export const useEnvStore = create<EnvState>((set, get) => ({
  projects: [],
  loading: false,
  importing: false,
  processStates: {},
  logsByCmd: {},
  activeLogTarget: null,
  aiAnalyzingIds: {},
  aiConfig: null,
  initialized: false,

  init: () => {
    if (!get().initialized) {
      set({ initialized: true });
      void get().loadProjects();
      void get().loadAIConfig();
      void api.getProcessStates().then((states) => {
        set({ processStates: states });
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

  loadProjects: async () => {
    set({ loading: true });
    try {
      const projects = await api.listProjects();
      set({ projects, loading: false });

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
          projects: exists ? s.projects.map((p) => (p.id === proj.id ? proj : p)) : [proj, ...s.projects],
        };
      });
      notify('success', `已导入项目「${proj.name}」，共识别 ${proj.commands.length} 条指令`);
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
          projects: exists ? s.projects.map((p) => (p.id === proj.id ? proj : p)) : [proj, ...s.projects],
        };
      });
      notify('success', `已导入项目「${proj.name}」，共识别 ${proj.commands.length} 条指令`);
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
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  deleteProject: async (projectId: string) => {
    try {
      await api.deleteProject(projectId);
      set((s) => ({
        projects: s.projects.filter((p) => p.id !== projectId),
        activeLogTarget: s.activeLogTarget?.projectId === projectId ? null : s.activeLogTarget,
      }));
      notify('info', '已移除项目');
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  saveCommand: async (projectId: string, cmd: ProjectCommand) => {
    try {
      const updated = await api.saveProjectCommand(projectId, cmd);
      set((s) => ({
        projects: s.projects.map((p) => (p.id === projectId ? updated : p)),
      }));
      notify('success', '指令已保存');
      return true;
    } catch (e) {
      notify('error', parseError(e).message);
      return false;
    }
  },

  deleteCommand: async (projectId: string, commandId: string) => {
    try {
      const updated = await api.deleteProjectCommand(projectId, commandId);
      set((s) => ({
        projects: s.projects.map((p) => (p.id === projectId ? updated : p)),
        activeLogTarget: s.activeLogTarget?.commandId === commandId ? null : s.activeLogTarget,
      }));
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
      set((s) => ({
        activeLogTarget: { projectId, commandId },
        logsByCmd: { ...s.logsByCmd, [commandId]: [] },
      }));
      await api.startCommand(projectId, commandId);
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  stopCommand: async (commandId: string) => {
    try {
      await api.stopCommand(commandId);
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  restartCommand: async (projectId: string, commandId: string) => {
    try {
      set((s) => ({
        activeLogTarget: { projectId, commandId },
        logsByCmd: { ...s.logsByCmd, [commandId]: [] },
      }));
      await api.restartCommand(projectId, commandId);
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  openLogDrawer: async (projectId: string, commandId: string) => {
    set({ activeLogTarget: { projectId, commandId } });
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
}));
