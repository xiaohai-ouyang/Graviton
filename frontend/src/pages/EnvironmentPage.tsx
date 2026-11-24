import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  FolderPlus,
  Layers,
  Loader2,
  Pin,
} from 'lucide-react';
import { useEnvStore } from '../store/useEnvStore';
import { ProjectCommand, ProjectRecord } from '../types';
import { CommandContextMenu, CommandContextMenuState } from '../components/CommandContextMenu';
import { CommandModal } from '../components/CommandModal';
import { TerminalPane } from '../components/TerminalPane';
import { ProjectCardDragPreview, SortableProjectCard } from '../components/ProjectCard';

const PINNED_ZONE_ID = 'zone:pinned';
const UNPINNED_ZONE_ID = 'zone:unpinned';

const LEFT_PANE_STORAGE_KEY = 'graviton_env_left_pane_width';
const DEFAULT_LEFT_PANE_WIDTH = 360;
const MIN_LEFT_PANE_WIDTH = 280;
const MIN_RIGHT_PANE_WIDTH = 320;
const KEYBOARD_RESIZE_STEP = 16;

function loadStoredLeftPaneWidth(): number {
  try {
    const raw = localStorage.getItem(LEFT_PANE_STORAGE_KEY);
    if (!raw) return DEFAULT_LEFT_PANE_WIDTH;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= MIN_LEFT_PANE_WIDTH) {
      return Math.round(parsed);
    }
  } catch {
    // Ignore storage read errors
  }
  return DEFAULT_LEFT_PANE_WIDTH;
}

function saveStoredLeftPaneWidth(width: number): void {
  try {
    localStorage.setItem(LEFT_PANE_STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Ignore storage write errors
  }
}

type ZoneKey = 'pinned' | 'unpinned';

interface ZoneContainers {
  pinned: string[];
  unpinned: string[];
}

function isZoneId(id: string): boolean {
  return id === PINNED_ZONE_ID || id === UNPINNED_ZONE_ID;
}

function zoneIdToKey(id: string): ZoneKey | null {
  if (id === PINNED_ZONE_ID) return 'pinned';
  if (id === UNPINNED_ZONE_ID) return 'unpinned';
  return null;
}

function findItemZone(containers: ZoneContainers, id: string): ZoneKey | null {
  const direct = zoneIdToKey(id);
  if (direct) return direct;
  if (containers.pinned.includes(id)) return 'pinned';
  if (containers.unpinned.includes(id)) return 'unpinned';
  return null;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface DroppableZoneProps {
  id: string;
  items: string[];
  emptyHint?: string;
  highlightEmpty?: boolean;
  children: React.ReactNode;
}

const DroppableZone: React.FC<DroppableZoneProps> = ({
  id,
  items,
  emptyHint,
  highlightEmpty,
  children,
}) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={`space-y-3 rounded-xl transition-colors ${
          items.length === 0 && highlightEmpty
            ? isOver
              ? 'border border-dashed border-amber-400/80 bg-amber-50/40 p-3 dark:border-amber-500/60 dark:bg-amber-500/10'
              : 'border border-dashed border-neutral-300/80 bg-neutral-100/50 p-3 dark:border-neutral-700/80 dark:bg-neutral-900/40'
            : ''
        }`}
      >
        {children}
        {items.length === 0 && emptyHint && (
          <p className="py-1.5 text-center text-[11px] text-neutral-400 dark:text-neutral-500">
            {emptyHint}
          </p>
        )}
      </div>
    </SortableContext>
  );
};

export const EnvironmentPage: React.FC = () => {
  const {
    projects,
    loading,
    importing,
    processStates,
    activeLogTarget,
    aiAnalyzingIds,
    aiConfig,
    collapsedProjects,
    init,
    selectAndImportProject,
    importProjectByPath,
    rescanProject,
    analyzeProjectWithAI,
    deleteProject,
    reorderProjects,
    togglePinProject,
    toggleCollapseProject,
    setAllProjectsCollapsed,
    saveCommand,
    deleteCommand,
    togglePinCommand,
    startCommand,
    stopCommand,
    restartCommand,
    openLogDrawer,
    openCommandInTerminal,
    openProjectFolder,
  } = useEnvStore();

  const [pathInput, setPathInput] = useState('');
  const [expandedMore, setExpandedMore] = useState<Record<string, boolean>>({});
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [cmdContextMenu, setCmdContextMenu] = useState<CommandContextMenuState | null>(null);
  const [cmdModalState, setCmdModalState] = useState<{
    open: boolean;
    projectId: string;
    editing: ProjectCommand | null;
  }>({ open: false, projectId: '', editing: null });

  // Resizable split pane state (left project list vs right terminal pane)
  const [preferredLeftWidth, setPreferredLeftWidth] = useState<number>(loadStoredLeftPaneWidth);
  const [splitContainerEl, setSplitContainerEl] = useState<HTMLDivElement | null>(null);
  const [splitContainerWidth, setSplitContainerWidth] = useState<number>(0);
  const [isResizingSplit, setIsResizingSplit] = useState(false);

  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (!splitContainerEl) return;

    const updateWidth = (width: number) => {
      if (width > 0) {
        setSplitContainerWidth(width);
      }
    };

    updateWidth(splitContainerEl.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateWidth(entry.contentRect.width);
    });
    observer.observe(splitContainerEl);

    return () => {
      observer.disconnect();
    };
  }, [splitContainerEl]);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  const maxLeftWidth =
    splitContainerWidth > 0
      ? Math.max(MIN_LEFT_PANE_WIDTH, Math.floor(splitContainerWidth - MIN_RIGHT_PANE_WIDTH))
      : Math.max(MIN_LEFT_PANE_WIDTH, preferredLeftWidth);

  const effectiveLeftWidth = Math.min(
    Math.max(preferredLeftWidth, MIN_LEFT_PANE_WIDTH),
    maxLeftWidth
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();

      resizeCleanupRef.current?.();

      const startX = e.clientX;
      const startWidth = effectiveLeftWidth;
      let latestWidth = startWidth;
      let didMove = false;

      const prevCursor = document.body.style.cursor;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      setIsResizingSplit(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        if (delta === 0 && !didMove) return;
        didMove = true;
        const containerW =
          splitContainerEl?.getBoundingClientRect().width ?? splitContainerWidth;
        const currentMax =
          containerW > 0
            ? Math.max(MIN_LEFT_PANE_WIDTH, Math.floor(containerW - MIN_RIGHT_PANE_WIDTH))
            : Infinity;
        const nextWidth = Math.round(
          Math.min(
            Math.max(startWidth + delta, MIN_LEFT_PANE_WIDTH),
            currentMax
          )
        );
        latestWidth = nextWidth;
        setPreferredLeftWidth(nextWidth);
      };

      const finishResize = () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', finishResize);
        window.removeEventListener('blur', finishResize);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevUserSelect;
        resizeCleanupRef.current = null;
        setIsResizingSplit(false);
        if (didMove) {
          saveStoredLeftPaneWidth(latestWidth);
        }
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', finishResize);
      window.addEventListener('blur', finishResize);
      resizeCleanupRef.current = finishResize;
    },
    [effectiveLeftWidth, splitContainerEl, splitContainerWidth]
  );

  const handleResetLeftWidth = useCallback(() => {
    setPreferredLeftWidth(DEFAULT_LEFT_PANE_WIDTH);
    saveStoredLeftPaneWidth(DEFAULT_LEFT_PANE_WIDTH);
  }, []);

  const handleDividerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = Math.max(MIN_LEFT_PANE_WIDTH, effectiveLeftWidth - KEYBOARD_RESIZE_STEP);
        setPreferredLeftWidth(next);
        saveStoredLeftPaneWidth(next);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const next = Math.min(maxLeftWidth, effectiveLeftWidth + KEYBOARD_RESIZE_STEP);
        setPreferredLeftWidth(next);
        saveStoredLeftPaneWidth(next);
      } else if (e.key === 'Home') {
        e.preventDefault();
        handleResetLeftWidth();
      }
    },
    [effectiveLeftWidth, maxLeftWidth, handleResetLeftWidth]
  );

  // Drag-and-drop local state (committed to backend on drop)
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragContainers, setDragContainers] = useState<ZoneContainers | null>(null);
  const [hadPinnedOnDragStart, setHadPinnedOnDragStart] = useState(false);

  const dragContainersRef = useRef<ZoneContainers | null>(null);
  const initialDragContainersRef = useRef<ZoneContainers | null>(null);

  useEffect(() => {
    const cleanup = init();
    return cleanup;
  }, [init]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const projectsById = useMemo(() => {
    const map = new Map<string, ProjectRecord>();
    for (const p of projects) {
      map.set(p.id, p);
    }
    return map;
  }, [projects]);

  const derivedContainers = useMemo<ZoneContainers>(() => {
    const pinned: string[] = [];
    const unpinned: string[] = [];
    for (const p of projects) {
      if (p.pinned) pinned.push(p.id);
      else unpinned.push(p.id);
    }
    return { pinned, unpinned };
  }, [projects]);

  const activeContainers = dragContainers ?? derivedContainers;
  const pinnedIds = activeContainers.pinned;
  const unpinnedIds = activeContainers.unpinned;

  const isDragging = activeDragId !== null;
  const showZoneHeaders = pinnedIds.length > 0 || (isDragging && hadPinnedOnDragStart);

  const allCollapsed = useMemo(
    () => projects.length > 0 && projects.every((p) => Boolean(collapsedProjects[p.id])),
    [projects, collapsedProjects]
  );

  const collisionDetection: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      const cardCollisions = pointerCollisions.filter((c) => !isZoneId(String(c.id)));
      if (cardCollisions.length > 0) {
        return cardCollisions;
      }

      // Pointer is inside a zone container gap or empty zone.
      const zoneCollision = pointerCollisions.find((c) => isZoneId(String(c.id)));
      if (zoneCollision) {
        const key = zoneIdToKey(String(zoneCollision.id));
        const current = dragContainersRef.current;
        if (key && current && current[key].length > 0) {
          const itemIds = new Set(current[key]);
          const zoneDroppables = args.droppableContainers.filter((dc) => itemIds.has(String(dc.id)));
          if (zoneDroppables.length > 0) {
            return closestCenter({
              ...args,
              droppableContainers: zoneDroppables,
            });
          }
        }
        return [zoneCollision];
      }
    }

    const rectCollisions = rectIntersection(args);
    if (rectCollisions.length > 0) {
      const cardCollisions = rectCollisions.filter((c) => !isZoneId(String(c.id)));
      return cardCollisions.length > 0 ? cardCollisions : rectCollisions;
    }

    return closestCenter(args);
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      const snapshot: ZoneContainers = {
        pinned: [...derivedContainers.pinned],
        unpinned: [...derivedContainers.unpinned],
      };
      setOpenMenuId(null);
      setCmdContextMenu(null);
      setActiveDragId(id);
      setHadPinnedOnDragStart(snapshot.pinned.length > 0);
      dragContainersRef.current = snapshot;
      initialDragContainersRef.current = {
        pinned: [...snapshot.pinned],
        unpinned: [...snapshot.unpinned],
      };
      setDragContainers(snapshot);
    },
    [derivedContainers]
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const current = dragContainersRef.current;
    if (!current) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    const activeZone = findItemZone(current, activeId);
    const overZone = findItemZone(current, overId);

    if (!activeZone || !overZone || activeZone === overZone) {
      return;
    }

    const sourceItems = [...current[activeZone]];
    const targetItems = [...current[overZone]];
    const activeIndex = sourceItems.indexOf(activeId);
    if (activeIndex < 0) return;

    sourceItems.splice(activeIndex, 1);

    let insertIndex: number;
    if (isZoneId(overId)) {
      insertIndex = targetItems.length;
    } else {
      const overIndex = targetItems.indexOf(overId);
      if (overIndex < 0) {
        insertIndex = targetItems.length;
      } else {
        const activeTop = active.rect.current.translated?.top ?? active.rect.current.initial?.top ?? 0;
        const overMidY = over.rect.top + over.rect.height / 2;
        insertIndex = activeTop > overMidY ? overIndex + 1 : overIndex;
      }
    }

    targetItems.splice(insertIndex, 0, activeId);

    const next: ZoneContainers = {
      ...current,
      [activeZone]: sourceItems,
      [overZone]: targetItems,
    };

    dragContainersRef.current = next;
    setDragContainers(next);
  }, []);

  const clearDragState = useCallback(() => {
    setActiveDragId(null);
    setDragContainers(null);
    setHadPinnedOnDragStart(false);
    dragContainersRef.current = null;
    initialDragContainersRef.current = null;
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const current = dragContainersRef.current;
      const initial = initialDragContainersRef.current;

      if (!current || !initial) {
        clearDragState();
        return;
      }

      let finalPinned = [...current.pinned];
      let finalUnpinned = [...current.unpinned];

      if (over) {
        const activeId = String(active.id);
        const overId = String(over.id);
        const activeZone = findItemZone(current, activeId);
        const overZone = findItemZone(current, overId);

        if (activeZone && overZone && activeZone === overZone && !isZoneId(overId) && activeId !== overId) {
          const list = activeZone === 'pinned' ? finalPinned : finalUnpinned;
          const oldIndex = list.indexOf(activeId);
          const newIndex = list.indexOf(overId);
          if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
            const moved = arrayMove(list, oldIndex, newIndex);
            if (activeZone === 'pinned') finalPinned = moved;
            else finalUnpinned = moved;
          }
        }
      }

      clearDragState();

      const changed =
        !arraysEqual(finalPinned, initial.pinned) || !arraysEqual(finalUnpinned, initial.unpinned);
      if (changed) {
        void reorderProjects(finalPinned, finalUnpinned);
      }
    },
    [clearDragState, reorderProjects]
  );

  const handleQuickImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pathInput.trim()) return;
    await importProjectByPath(pathInput);
    setPathInput('');
  };

  const toggleMore = (projectId: string) => {
    setExpandedMore((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  };

  const renderProjectCard = (projectId: string, isPinned: boolean) => {
    const project = projectsById.get(projectId);
    if (!project) return null;

    return (
      <SortableProjectCard
        key={project.id}
        project={project}
        isPinned={isPinned}
        collapsed={Boolean(collapsedProjects[project.id])}
        processStates={processStates}
        activeCommandId={activeLogTarget?.commandId ?? null}
        isAnalyzing={Boolean(aiAnalyzingIds[project.id])}
        aiEnabled={Boolean(aiConfig?.enabled)}
        showMore={Boolean(expandedMore[project.id])}
        menuOpen={openMenuId === project.id}
        contextMenuCommandId={
          cmdContextMenu?.projectId === project.id ? cmdContextMenu.command.id : null
        }
        onToggleCollapse={() => toggleCollapseProject(project.id)}
        onTogglePin={() => void togglePinProject(project.id)}
        onToggleMenu={() => {
          setCmdContextMenu(null);
          setOpenMenuId((prev) => (prev === project.id ? null : project.id));
        }}
        onCloseMenu={() => setOpenMenuId((prev) => (prev === project.id ? null : prev))}
        onToggleMore={() => toggleMore(project.id)}
        onSelectCommand={(cmdId) => void openLogDrawer(project.id, cmdId)}
        onCommandContextMenu={(cmd, e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpenMenuId(null);
          setCmdContextMenu({
            projectId: project.id,
            command: cmd,
            x: e.clientX,
            y: e.clientY,
          });
        }}
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
    );
  };

  const activeDragProject = activeDragId ? projectsById.get(activeDragId) ?? null : null;
  const activeDragIsPinned = activeDragId ? pinnedIds.includes(activeDragId) : false;
  const activeDragRunningCount = activeDragProject
    ? activeDragProject.commands.filter((c) => processStates[c.id]?.status === 'running').length
    : 0;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Top Bar */}
      <header className="shrink-0 border-b border-neutral-200/80 bg-card/80 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/80">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <h2 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            环境
          </h2>

          <div className="flex items-center gap-2">
            <form onSubmit={handleQuickImport} className="hidden items-center sm:flex">
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder="粘贴项目路径回车导入，如 D:\Projects\Graviton"
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
        <div ref={setSplitContainerEl} className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left Pane: Sortable Project & Command List */}
          <aside
            style={{ width: effectiveLeftWidth, minWidth: MIN_LEFT_PANE_WIDTH }}
            className="shrink-0 overflow-y-scroll bg-neutral-50/70 py-4 pl-4 pr-2.5 dark:bg-neutral-950/60"
          >
            {/* Compact Toolbar: Count + Bulk Collapse/Expand */}
            {projects.length > 1 && (
              <div className="mb-2.5 flex items-center justify-between px-0.5">
                <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                  共 {projects.length} 个项目
                </span>
                <button
                  type="button"
                  onClick={() => setAllProjectsCollapsed(!allCollapsed)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                >
                  {allCollapsed ? (
                    <>
                      <ChevronsUpDown className="h-3 w-3" />
                      <span>全部展开</span>
                    </>
                  ) : (
                    <>
                      <ChevronsDownUp className="h-3 w-3" />
                      <span>全部折叠</span>
                    </>
                  )}
                </button>
              </div>
            )}

            <DndContext
              sensors={sensors}
              collisionDetection={collisionDetection}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={clearDragState}
            >
              <div className="space-y-4">
                {showZoneHeaders && (
                  <section className="space-y-2">
                    <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-amber-600/90 dark:text-amber-400/90">
                      <Pin className="h-3 w-3 fill-current" />
                      <span>已置顶</span>
                      <span className="text-neutral-400 dark:text-neutral-500">
                        ({pinnedIds.length})
                      </span>
                    </div>
                    <DroppableZone
                      id={PINNED_ZONE_ID}
                      items={pinnedIds}
                      highlightEmpty={isDragging}
                      emptyHint={isDragging ? '拖放到此处保持置顶' : undefined}
                    >
                      {pinnedIds.map((id) => renderProjectCard(id, true))}
                    </DroppableZone>
                  </section>
                )}

                {(unpinnedIds.length > 0 || (isDragging && showZoneHeaders)) && (
                  <section className="space-y-2">
                    {showZoneHeaders && (
                      <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                        <span>其他项目</span>
                        <span>({unpinnedIds.length})</span>
                      </div>
                    )}
                    <DroppableZone
                      id={UNPINNED_ZONE_ID}
                      items={unpinnedIds}
                      highlightEmpty={isDragging && showZoneHeaders}
                      emptyHint={isDragging && showZoneHeaders ? '拖放到此处取消置顶' : undefined}
                    >
                      {unpinnedIds.map((id) => renderProjectCard(id, false))}
                    </DroppableZone>
                  </section>
                )}
              </div>

              <DragOverlay dropAnimation={null}>
                {activeDragProject ? (
                  <ProjectCardDragPreview
                    project={activeDragProject}
                    isPinned={activeDragIsPinned}
                    runningCount={activeDragRunningCount}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          </aside>

          {/* Resizable Split Divider */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整项目栏与终端区域宽度"
            aria-valuemin={MIN_LEFT_PANE_WIDTH}
            aria-valuemax={maxLeftWidth}
            aria-valuenow={effectiveLeftWidth}
            tabIndex={0}
            title="拖动调整宽度，双击恢复默认"
            onMouseDown={handleResizeStart}
            onDoubleClick={handleResetLeftWidth}
            onKeyDown={handleDividerKeyDown}
            className="group/divider relative z-10 w-px shrink-0 cursor-col-resize bg-neutral-200 outline-hidden select-none focus-visible:bg-neutral-500 dark:bg-neutral-800 dark:focus-visible:bg-neutral-400"
          >
            {/* Wider invisible hit zone */}
            <div className="absolute inset-y-0 -right-1.5 -left-1.5" />
            {/* Highlight accent line on hover / drag */}
            <div
              className={`pointer-events-none absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 transition-opacity duration-150 ${
                isResizingSplit
                  ? 'bg-neutral-400 opacity-100 dark:bg-neutral-500'
                  : 'bg-neutral-300 opacity-0 group-hover/divider:opacity-100 group-focus-visible/divider:opacity-100 dark:bg-neutral-600'
              }`}
            />
            {/* Subtle centered grip pill */}
            <div
              className={`pointer-events-none absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-150 ${
                isResizingSplit
                  ? 'bg-neutral-600 opacity-100 dark:bg-neutral-300'
                  : 'bg-neutral-400 opacity-0 group-hover/divider:opacity-100 group-focus-visible/divider:opacity-100 dark:bg-neutral-400'
              }`}
            />
          </div>

          {/* Right Pane: Persistent Embedded Terminal */}
          <TerminalPane
            onEditCommand={(projectId, cmd) =>
              setCmdModalState({ open: true, projectId, editing: cmd })
            }
          />
        </div>
      )}

      <CommandContextMenu
        state={cmdContextMenu}
        onClose={() => setCmdContextMenu(null)}
        onEdit={(projectId, cmd) =>
          setCmdModalState({ open: true, projectId, editing: cmd })
        }
        onTogglePin={(projectId, commandId) => void togglePinCommand(projectId, commandId)}
        onOpenInTerminal={(projectId, commandId) =>
          void openCommandInTerminal(projectId, commandId)
        }
        onDelete={(projectId, commandId) => void deleteCommand(projectId, commandId)}
      />

      <CommandModal
        open={cmdModalState.open}
        initial={cmdModalState.editing}
        onClose={() => setCmdModalState({ open: false, projectId: '', editing: null })}
        onSave={(cmd) => saveCommand(cmdModalState.projectId, cmd)}
      />
    </div>
  );
};
