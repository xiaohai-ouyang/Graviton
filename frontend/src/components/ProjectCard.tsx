import React, { useEffect, useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FolderOpen,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEnvStore } from '../store/useEnvStore';
import { useMotionStore } from '../store/useMotionStore';
import { ProcessState, ProjectCommand, ProjectRecord } from '../types';
import { SHELL_META, normalizeDefaultShell, normalizeShellOverride } from '../utils/shell';

export interface ProjectCardProps {
  project: ProjectRecord;
  isPinned: boolean;
  collapsed: boolean;
  processStates: Record<string, ProcessState>;
  activeCommandId: string | null;
  isAnalyzing: boolean;
  aiEnabled: boolean;
  showMore: boolean;
  menuOpen: boolean;
  contextMenuCommandId: string | null;
  onToggleCollapse: () => void;
  onTogglePin: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onToggleMore: () => void;
  onSelectCommand: (commandId: string) => void;
  onCommandContextMenu: (command: ProjectCommand, e: React.MouseEvent) => void;
  onStart: (commandId: string) => void;
  onStop: (commandId: string) => void;
  onRestart: (commandId: string) => void;
  onAddCommand: () => void;
  onOpenFolder: () => void;
  onRescan: () => void;
  onAIAnalyze: () => void;
  onDeleteProject: () => void;
}

export const SortableProjectCard: React.FC<ProjectCardProps> = (props) => {
  const {
    project,
    isPinned,
    collapsed,
    processStates,
    activeCommandId,
    isAnalyzing,
    aiEnabled,
    showMore,
    menuOpen,
    contextMenuCommandId,
    onToggleCollapse,
    onTogglePin,
    onToggleMenu,
    onCloseMenu,
    onToggleMore,
    onSelectCommand,
    onCommandContextMenu,
    onStart,
    onStop,
    onRestart,
    onAddCommand,
    onOpenFolder,
    onRescan,
    onAIAnalyze,
    onDeleteProject,
  } = props;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: project.id,
  });

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleDocMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onCloseMenu();
      }
    };
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => document.removeEventListener('mousedown', handleDocMouseDown);
  }, [menuOpen, onCloseMenu]);

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);
  const defaultShell = normalizeDefaultShell(
    useEnvStore((s) => s.shellEnv?.config.defaultShell)
  );
  const canAnimate = shouldAnimate && !isDragging;

  const coreCommands = project.commands.filter((c) => c.pinned);
  const extraCommands = project.commands.filter((c) => !c.pinned);
  const primaryCommands = coreCommands.length > 0 ? coreCommands : project.commands;
  const hasCollapsibleExtras = coreCommands.length > 0 && extraCommands.length > 0;

  const runningCount = project.commands.filter(
    (c) => processStates[c.id]?.status === 'running'
  ).length;

  const renderCommandRow = (cmd: ProjectCommand) => {
    const state = processStates[cmd.id];
    const isRunning = state?.status === 'running';
    const isSelected = activeCommandId === cmd.id;
    const isContextMenuOpen = contextMenuCommandId === cmd.id;
    const shellOverride = normalizeShellOverride(cmd.shell);
    const overrideMeta =
      shellOverride !== '' && shellOverride !== defaultShell
        ? SHELL_META[shellOverride]
        : null;

    return (
      <div
        key={cmd.id}
        onClick={() => onSelectCommand(cmd.id)}
        onContextMenu={(e) => onCommandContextMenu(cmd, e)}
        className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
          isSelected
            ? 'border-neutral-300 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800'
            : 'border-transparent bg-neutral-50/80 hover:bg-neutral-100/80 dark:bg-neutral-950/60 dark:hover:bg-neutral-800/50'
        } ${isContextMenuOpen ? 'ring-1 ring-neutral-300 dark:ring-neutral-600' : ''}`}
      >
        <Tooltip.Root open={isDragging || isContextMenuOpen ? false : undefined}>
          <Tooltip.Trigger asChild>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                {cmd.name}
              </span>
              {overrideMeta && (
                <span
                  className={`shrink-0 rounded px-1 py-0.2 font-mono text-[10px] font-medium ${overrideMeta.badgeClass}`}
                >
                  {overrideMeta.shortLabel}
                </span>
              )}
              {cmd.cwd && (
                <span className="shrink-0 rounded bg-neutral-200/80 px-1 py-0.2 font-mono text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  {cmd.cwd}
                </span>
              )}
            </div>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              side="top"
              align="start"
              sideOffset={6}
              className="z-50 max-w-xs whitespace-pre-wrap break-all rounded-lg border border-neutral-200/20 bg-neutral-900 px-2.5 py-1.5 font-mono text-[11px] text-neutral-100 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
            >
              {cmd.command}
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

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
                className="inline-flex h-6 items-center gap-1 rounded-md border border-neutral-200 bg-card px-2 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <RotateCw className="h-2.5 w-2.5" />
                <span>重启</span>
              </button>
              <button
                type="button"
                onClick={() => onStop(cmd.id)}
                title="停止"
                className="inline-flex h-6 items-center gap-1 rounded-md bg-rose-600 px-2 text-[11px] font-medium text-white transition-colors hover:bg-rose-500"
              >
                <Square className="h-2 w-2 fill-current" />
                <span>停止</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onStart(cmd.id)}
              className="inline-flex h-6 items-center gap-1 rounded-md bg-neutral-900 px-2 text-[11px] font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <Play className="h-2 w-2 fill-current" />
              <span>启动</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/card rounded-xl border bg-card px-3 py-2.5 shadow-2xs transition-colors dark:bg-neutral-900 ${
        isDragging
          ? 'border-dashed border-neutral-300 opacity-35 dark:border-neutral-600'
          : isPinned
          ? 'border-amber-200/80 dark:border-amber-500/25'
          : 'border-neutral-200 dark:border-neutral-800'
      }`}
    >
      {/* Project Header */}
      <div className="group/header relative flex items-center justify-between gap-1.5">
        {/* Left: Drag Handle + Clickable Collapse Area */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {/* Dedicated 6-dot Drag Handle */}
          <button
            ref={setActivatorNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            title="拖拽调整顺序"
            aria-label={`拖拽 ${project.name}`}
            className="inline-flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-600 active:cursor-grabbing group-hover/card:text-neutral-400 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300 dark:group-hover/card:text-neutral-500"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>

          {/* Clickable Header Body for Collapse / Expand */}
          <div
            role="button"
            tabIndex={0}
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onToggleCollapse();
              }
            }}
            className="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-1.5 rounded-lg py-0.5 pr-1 text-left"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-150 dark:text-neutral-500 ${
                collapsed ? '' : 'rotate-90'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Tooltip.Root open={isDragging ? false : undefined}>
                  <Tooltip.Trigger asChild>
                    <h3 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {project.name}
                    </h3>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="top"
                      align="start"
                      sideOffset={6}
                      className="z-50 max-w-xs break-all rounded-lg border border-neutral-200/20 bg-neutral-900 px-2.5 py-1.5 font-mono text-[11px] text-neutral-100 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
                    >
                      {project.path}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
                {runningCount > 0 && (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                    {runningCount} 运行中
                  </span>
                )}
                {isAnalyzing && (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-neutral-400" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Quick Pin Button + ··· Menu */}
        <div
          ref={menuRef}
          className="relative flex shrink-0 items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onTogglePin}
            title={isPinned ? '取消置顶' : '置顶项目'}
            aria-label={isPinned ? `取消置顶 ${project.name}` : `置顶 ${project.name}`}
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all ${
              isPinned
                ? 'bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-400 dark:hover:bg-amber-500/25'
                : 'text-neutral-400 opacity-0 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:opacity-100 group-hover/header:opacity-100 group-hover/card:opacity-100 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            <Pin className={`h-3.5 w-3.5 ${isPinned ? 'fill-current' : ''}`} />
          </button>

          <button
            type="button"
            onClick={onToggleMenu}
            title="项目操作"
            aria-label={`${project.name} 更多操作`}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={canAnimate ? { opacity: 0, scale: 0.95, y: -4 } : false}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={canAnimate ? { opacity: 0, scale: 0.95, y: -4 } : { opacity: 0 }}
                transition={
                  canAnimate
                    ? { duration: 0.13, ease: [0.22, 1, 0.36, 1] }
                    : { duration: 0 }
                }
                style={{ transformOrigin: 'top right' }}
                className="absolute top-8 right-0 z-30 w-40 rounded-xl border border-neutral-200 bg-card p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
              >
                <button
                  type="button"
                  onClick={() => {
                    onCloseMenu();
                    onTogglePin();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  {isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                  <span>{isPinned ? '取消置顶' : '置顶项目'}</span>
                </button>
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Collapsible Body: Commands List + More Toggle */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="card-body"
            initial={canAnimate ? { height: 0, opacity: 0 } : false}
            animate={{ height: 'auto', opacity: 1 }}
            exit={canAnimate ? { height: 0, opacity: 0 } : { opacity: 0 }}
            transition={
              canAnimate
                ? { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
                : { duration: 0 }
            }
            className="overflow-hidden"
          >
            <div className="pt-2.5 pb-1">
              <div className="space-y-1.5">
                {project.commands.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-neutral-200 py-3 text-center text-xs text-neutral-400 dark:border-neutral-800">
                    暂无指令，可在右上角 ··· 中新增
                  </p>
                ) : (
                  primaryCommands.map((cmd) => renderCommandRow(cmd))
                )}
              </div>

              {/* Extra Commands Animated Section */}
              {hasCollapsibleExtras && (
                <>
                  <AnimatePresence initial={false}>
                    {showMore && (
                      <motion.div
                        key="extra-commands"
                        initial={canAnimate ? { height: 0, opacity: 0 } : false}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={canAnimate ? { height: 0, opacity: 0 } : { opacity: 0 }}
                        transition={
                          canAnimate
                            ? { duration: 0.16, ease: [0.22, 1, 0.36, 1] }
                            : { duration: 0 }
                        }
                        className="overflow-hidden"
                      >
                        <div className="space-y-1.5 pt-1.5">
                          {extraCommands.map((cmd) => renderCommandRow(cmd))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

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
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

interface ProjectCardDragPreviewProps {
  project: ProjectRecord;
  isPinned: boolean;
  runningCount: number;
}

/** Compact single-line floating preview rendered inside DragOverlay while dragging a project card. */
export const ProjectCardDragPreview: React.FC<ProjectCardDragPreviewProps> = ({
  project,
  isPinned,
  runningCount,
}) => {
  return (
    <div
      className={`flex cursor-grabbing items-center justify-between gap-2 rounded-xl border bg-card/95 px-3 py-2.5 shadow-xl ring-1 backdrop-blur-xs dark:bg-neutral-900/95 ${
        isPinned
          ? 'border-amber-300 ring-amber-400/30 dark:border-amber-500/50 dark:ring-amber-500/20'
          : 'border-neutral-300 ring-neutral-400/25 dark:border-neutral-700 dark:ring-neutral-600/30'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="inline-flex h-6 w-5 shrink-0 items-center justify-center text-neutral-500 dark:text-neutral-400">
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
        <h3 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {project.name}
        </h3>
        {runningCount > 0 && (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
            {runningCount} 运行中
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {isPinned && (
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
            <Pin className="h-3.5 w-3.5 fill-current" />
          </span>
        )}
        <span className="inline-flex h-6 w-6 items-center justify-center text-neutral-400 dark:text-neutral-500">
          <MoreHorizontal className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
};
