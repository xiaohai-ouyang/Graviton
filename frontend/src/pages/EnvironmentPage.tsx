import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FolderOpen,
  FolderPlus,
  Layers,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { useEnvStore } from '../store/useEnvStore';
import { ProcessState, ProjectCommand, ProjectRecord } from '../types';
import { CommandModal } from '../components/CommandModal';
import { TerminalPane } from '../components/TerminalPane';

export const EnvironmentPage: React.FC = () => {
  const {
    projects,
    loading,
    importing,
    processStates,
    activeLogTarget,
    aiAnalyzingIds,
    aiConfig,
    init,
    selectAndImportProject,
    importProjectByPath,
    rescanProject,
    analyzeProjectWithAI,
    deleteProject,
    saveCommand,
    startCommand,
    stopCommand,
    restartCommand,
    openLogDrawer,
    openProjectFolder,
  } = useEnvStore();

  const [pathInput, setPathInput] = useState('');
  const [expandedMore, setExpandedMore] = useState<Record<string, boolean>>({});
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [cmdModalState, setCmdModalState] = useState<{
    open: boolean;
    projectId: string;
    editing: ProjectCommand | null;
  }>({ open: false, projectId: '', editing: null });

  const menuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanup = init();
    return cleanup;
  }, [init]);

  useEffect(() => {
    if (!openMenuId) return;
    const handleDocClick = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [openMenuId]);

  const handleQuickImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pathInput.trim()) return;
    await importProjectByPath(pathInput);
    setPathInput('');
  };

  const toggleMore = (projectId: string) => {
    setExpandedMore((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top Bar */}
      <header className="shrink-0 border-b border-neutral-200/80 bg-card/80 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/80">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              环境
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              启动、停止、重启项目并查看实时终端输出
            </p>
          </div>

          <div className="flex items-center gap-2">
            <form onSubmit={handleQuickImport} className="hidden items-center sm:flex">
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder="粘贴项目路径回车导入，如 F:\CodeProject\CodeTool"
                className="w-64 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              />
            </form>

            <button
              type="button"
              disabled={importing}
              onClick={() => void selectAndImportProject()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderPlus className="h-3.5 w-3.5" />
              )}
              <span>{importing ? '导入中...' : '导入项目'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Split View */}
      {loading && projects.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          加载项目中...
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex max-w-md flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-card/60 px-8 py-12 text-center dark:border-neutral-800">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              <Layers className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              还没有导入任何项目
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              点击右上角「导入项目」选择本地代码目录，自动识别启动、构建等常用指令。
            </p>
            <button
              type="button"
              onClick={() => void selectAndImportProject()}
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              <span>选择项目目录</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left Pane: Minimal Project & Command List */}
          <aside
            ref={menuContainerRef}
            className="w-[360px] shrink-0 space-y-3 overflow-y-auto border-r border-neutral-200 bg-neutral-50/70 p-4 lg:w-[410px] dark:border-neutral-800 dark:bg-neutral-950/60"
          >
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                processStates={processStates}
                activeCommandId={activeLogTarget?.commandId ?? null}
                isAnalyzing={Boolean(aiAnalyzingIds[project.id])}
                aiEnabled={Boolean(aiConfig?.enabled)}
                showMore={Boolean(expandedMore[project.id])}
                menuOpen={openMenuId === project.id}
                onToggleMenu={() => setOpenMenuId((prev) => (prev === project.id ? null : project.id))}
                onCloseMenu={() => setOpenMenuId(null)}
                onToggleMore={() => toggleMore(project.id)}
                onSelectCommand={(cmdId) => void openLogDrawer(project.id, cmdId)}
                onStart={(cmdId) => void startCommand(project.id, cmdId)}
                onStop={(cmdId) => void stopCommand(cmdId)}
                onRestart={(cmdId) => void restartCommand(project.id, cmdId)}
                onAddCommand={() => {
                  setOpenMenuId(null);
                  setCmdModalState({ open: true, projectId: project.id, editing: null });
                }}
                onOpenFolder={() => {
                  setOpenMenuId(null);
                  void openProjectFolder(project.id);
                }}
                onRescan={() => {
                  setOpenMenuId(null);
                  void rescanProject(project.id);
                }}
                onAIAnalyze={() => {
                  setOpenMenuId(null);
                  void analyzeProjectWithAI(project.id);
                }}
                onDeleteProject={() => {
                  setOpenMenuId(null);
                  void deleteProject(project.id);
                }}
              />
            ))}
          </aside>

          {/* Right Pane: Persistent Embedded Terminal */}
          <TerminalPane
            onEditCommand={(projectId, cmd) =>
              setCmdModalState({ open: true, projectId, editing: cmd })
            }
          />
        </div>
      )}

      <CommandModal
        open={cmdModalState.open}
        initial={cmdModalState.editing}
        onClose={() => setCmdModalState({ open: false, projectId: '', editing: null })}
        onSave={(cmd) => saveCommand(cmdModalState.projectId, cmd)}
      />
    </div>
  );
};

interface ProjectCardProps {
  project: ProjectRecord;
  processStates: Record<string, ProcessState>;
  activeCommandId: string | null;
  isAnalyzing: boolean;
  aiEnabled: boolean;
  showMore: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onToggleMore: () => void;
  onSelectCommand: (commandId: string) => void;
  onStart: (commandId: string) => void;
  onStop: (commandId: string) => void;
  onRestart: (commandId: string) => void;
  onAddCommand: () => void;
  onOpenFolder: () => void;
  onRescan: () => void;
  onAIAnalyze: () => void;
  onDeleteProject: () => void;
}

const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  processStates,
  activeCommandId,
  isAnalyzing,
  aiEnabled,
  showMore,
  menuOpen,
  onToggleMenu,
  onToggleMore,
  onSelectCommand,
  onStart,
  onStop,
  onRestart,
  onAddCommand,
  onOpenFolder,
  onRescan,
  onAIAnalyze,
  onDeleteProject,
}) => {
  const coreCommands = project.commands.filter((c) => c.pinned);
  const extraCommands = project.commands.filter((c) => !c.pinned);
  const visibleCommands =
    coreCommands.length > 0 ? (showMore ? project.commands : coreCommands) : project.commands;

  const runningCount = project.commands.filter((c) => {
    return processStates[c.id]?.status === 'running';
  }).length;

  return (
    <div className="rounded-xl border border-neutral-200 bg-card p-3.5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900">
      {/* Project Header */}
      <div className="relative flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3
              title={project.path}
              className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100"
            >
              {project.name}
            </h3>
            {runningCount > 0 && (
              <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                {runningCount} 运行中
              </span>
            )}
            {isAnalyzing && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-400" />
            )}
          </div>
          <p
            title={project.path}
            className="mt-0.5 truncate font-mono text-[11px] text-neutral-400 dark:text-neutral-500"
          >
            {project.path}
          </p>
        </div>

        {/* ··· Dropdown Trigger */}
        <button
          type="button"
          onClick={onToggleMenu}
          title="项目操作"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        {menuOpen && (
          <div className="absolute top-8 right-0 z-30 w-40 rounded-xl border border-neutral-200 bg-card p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            <button
              type="button"
              onClick={onAddCommand}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新增指令</span>
            </button>
            <button
              type="button"
              onClick={onOpenFolder}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              <span>打开目录</span>
            </button>
            <button
              type="button"
              onClick={onRescan}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>重新扫描</span>
            </button>
            {aiEnabled && (
              <button
                type="button"
                onClick={onAIAnalyze}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>AI 优化指令</span>
              </button>
            )}
            <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
            <button
              type="button"
              onClick={onDeleteProject}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>移除项目</span>
            </button>
          </div>
        )}
      </div>

      {/* Commands List */}
      <div className="mt-3 space-y-1.5">
        {visibleCommands.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-200 py-3 text-center text-xs text-neutral-400 dark:border-neutral-800">
            暂无指令，可在右上角 ··· 中新增
          </p>
        ) : (
          visibleCommands.map((cmd) => {
            const state = processStates[cmd.id];
            const isRunning = state?.status === 'running';
            const isFailed = state?.status === 'error';
            const isSelected = activeCommandId === cmd.id;

            return (
              <div
                key={cmd.id}
                onClick={() => onSelectCommand(cmd.id)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                  isSelected
                    ? 'border-neutral-300 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800'
                    : 'border-transparent bg-neutral-50/80 hover:bg-neutral-100/80 dark:bg-neutral-950/60 dark:hover:bg-neutral-800/50'
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      isRunning
                        ? 'bg-emerald-500 animate-pulse'
                        : isFailed
                        ? 'bg-rose-500'
                        : 'bg-neutral-300 dark:bg-neutral-700'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                        {cmd.name}
                      </span>
                      {cmd.cwd && (
                        <span className="shrink-0 rounded bg-neutral-200/80 px-1 py-0.2 font-mono text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                          {cmd.cwd}
                        </span>
                      )}
                    </div>
                    <p className="truncate font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                      {cmd.command}
                    </p>
                  </div>
                </div>

                {/* Only Start / Stop / Restart */}
                <div
                  className="flex shrink-0 items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isRunning ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onRestart(cmd.id)}
                        title="重启"
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-neutral-200 bg-card px-2 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        <RotateCw className="h-3 w-3" />
                        <span>重启</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onStop(cmd.id)}
                        title="停止"
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-rose-600 px-2 text-[11px] font-medium text-white transition-colors hover:bg-rose-500"
                      >
                        <Square className="h-2.5 w-2.5 fill-current" />
                        <span>停止</span>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onStart(cmd.id)}
                      className="inline-flex h-7 items-center gap-1 rounded-md bg-neutral-900 px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                    >
                      <Play className="h-2.5 w-2.5 fill-current" />
                      <span>启动</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Expand/Collapse extra commands */}
      {coreCommands.length > 0 && extraCommands.length > 0 && (
        <button
          type="button"
          onClick={onToggleMore}
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500 transition-colors hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          {showMore ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              <span>收起</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              <span>更多指令 ({extraCommands.length})</span>
            </>
          )}
        </button>
      )}
    </div>
  );
};
