import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileClock,
  FolderOpen,
  GitCommitHorizontal,
  Hourglass,
  Layers,
  Loader2,
  MonitorCheck,
  Palette,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Sparkles,
  Terminal,
  WandSparkles,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { api, parseError } from '../../services/api';
import { useAccountStore } from '../../store/useAccountStore';
import { useAppInfoStore } from '../../store/useAppInfoStore';
import { useEnvStore } from '../../store/useEnvStore';
import { useMotionStore } from '../../store/useMotionStore';
import { useQianwenStore } from '../../store/useQianwenStore';
import { useResetTimeStore } from '../../store/useResetTimeStore';
import {
  extractSettingsSlug,
  getBackgroundLocation,
  isEmptyQuotaPath,
  isSettingsPath,
  resolveSafeQuotaFallback,
  resolveSettingsSection,
  SettingsRouteState,
  SettingsSectionId,
  useSettingsModalStore,
} from '../../store/useSettingsModalStore';
import { useUpdateStore } from '../../store/useUpdateStore';
import { AIConfig, ShellAvailability } from '../../types';
import { hasOtherDialogOpen, isFeedbackBannerEvent } from '../../utils/dialog';
import { normalizeDefaultShell, SHELL_META, SHELL_ORDER } from '../../utils/shell';
import { ChangeItemRow, CHANNEL_META } from '../ChangelogModal';
import { MotionToggle } from '../MotionToggle';
import { ProvidersSettingsSection } from './ProvidersSettingsSection';
import { ResetTimeModeToggle } from '../ResetTimeModeToggle';
import { ThemeToggle } from '../ThemeToggle';
import {
  searchSettingsEntries,
  SETTINGS_SECTION_MAP,
  SETTINGS_SECTIONS,
  SettingsSearchEntry,
} from './settingsRegistry';

export const SettingsModal: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const {
    clientPath,
    loadClientPath,
    selectClientPath,
    widgetAlwaysOnTop,
    loadWidgetAlwaysOnTop,
    setWidgetAlwaysOnTop,
  } = useAccountStore();

  const {
    aiConfig,
    loadAIConfig,
    saveAIConfig,
    testAIConfig,
    shellEnv,
    loadShellEnvironment,
    saveShellConfig,
    selectGitBashPath,
    resetGitBashPath,
  } = useEnvStore();

  const { appInfo, changelog, loadAppInfo, openChangelog } = useAppInfoStore();
  const { motionMode, shouldAnimate, autoReason } = useMotionStore();
  const resetTimeFormat = useResetTimeStore((s) => s.resetTimeFormat);
  const setLastSection = useSettingsModalStore((s) => s.setLastSection);
  const {
    state: updateState,
    checking: updateChecking,
    savingSettings: savingUpdateSettings,
    checkForUpdates,
    saveSettings: saveUpdateSettings,
    requestInstall,
    cancelDeferred,
    setModalOpen: setUpdateModalOpen,
  } = useUpdateStore();

  const isOpen = isSettingsPath(location.pathname);
  const rawSlug = extractSettingsSlug(location.pathname);
  const { section: activeSection, isCanonical } = resolveSettingsSection(rawSlug);
  const activeSectionMeta = SETTINGS_SECTION_MAP[activeSection];

  const [mirrorInput, setMirrorInput] = useState('');
  const [aiForm, setAiForm] = useState<AIConfig>({
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  });
  const [showKey, setShowKey] = useState(false);
  const [testingAI, setTestingAI] = useState(false);
  const [savingAI, setSavingAI] = useState(false);
  const [savingShell, setSavingShell] = useState(false);
  const [expandedReleases, setExpandedReleases] = useState<Record<string, boolean>>({});

  const [searchQuery, setSearchQuery] = useState('');
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [pendingAnchorId, setPendingAnchorId] = useState<string | null>(null);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const searchResults = useMemo(
    () => searchSettingsEntries(searchQuery),
    [searchQuery]
  );

  // Canonicalize #/settings or alias paths such as #/settings/shell
  useEffect(() => {
    if (!isOpen || isCanonical) return;
    navigate(`/settings/${activeSection}${location.hash}`, {
      replace: true,
      state: location.state,
    });
  }, [isOpen, isCanonical, activeSection, location.hash, location.state, navigate]);

  // Remember last canonical section
  useEffect(() => {
    if (isOpen && isCanonical) {
      setLastSection(activeSection);
    }
  }, [isOpen, isCanonical, activeSection, setLastSection]);

  // Load settings data when modal opens
  useEffect(() => {
    if (!isOpen) return;
    loadClientPath();
    loadWidgetAlwaysOnTop();
    void loadAIConfig();
    void loadShellEnvironment();
    void loadAppInfo();
    if (!useUpdateStore.getState().state) {
      void useUpdateStore.getState().loadUpdateState();
    }
  }, [
    isOpen,
    loadClientPath,
    loadWidgetAlwaysOnTop,
    loadAIConfig,
    loadShellEnvironment,
    loadAppInfo,
  ]);

  // Sync AI form when store config loads or updates
  useEffect(() => {
    if (aiConfig) {
      setAiForm(aiConfig);
    }
  }, [aiConfig]);

  useEffect(() => {
    if (updateState) {
      setMirrorInput(updateState.mirrorUrl || '');
    }
  }, [updateState?.mirrorUrl]);

  // Pick up URL hash anchor when opening via deep link
  useEffect(() => {
    if (!isOpen) return;
    const rawHash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    if (!rawHash) return;
    try {
      setPendingAnchorId(decodeURIComponent(rawHash));
    } catch {
      setPendingAnchorId(rawHash);
    }
  }, [isOpen, location.hash]);

  // Reset transient search/highlight state when modal closes
  useEffect(() => {
    if (isOpen) return;
    setSearchQuery('');
    setActiveResultIndex(0);
    setPendingAnchorId(null);
    setHighlightedEntryId(null);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
  }, [isOpen]);

  // Keep activeResultIndex bounded when search results change
  useEffect(() => {
    setActiveResultIndex(0);
  }, [searchQuery]);

  // Scroll to and pulse-highlight the pending target entry
  useEffect(() => {
    if (!isOpen || !isCanonical || !pendingAnchorId) return;

    const targetId = pendingAnchorId;
    const rafId = window.requestAnimationFrame(() => {
      const container = contentScrollRef.current;
      if (!container) return;
      const targetEl = Array.from(
        container.querySelectorAll<HTMLElement>('[data-settings-entry-id]')
      ).find((el) => el.getAttribute('data-settings-entry-id') === targetId);

      setPendingAnchorId(null);
      if (!targetEl) return;

      targetEl.scrollIntoView({
        behavior: shouldAnimate ? 'smooth' : 'auto',
        block: 'center',
      });
      setHighlightedEntryId(targetId);

      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = window.setTimeout(() => {
        setHighlightedEntryId((current) => (current === targetId ? null : current));
        highlightTimerRef.current = null;
      }, 1500);
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [isOpen, isCanonical, activeSection, pendingAnchorId, shouldAnimate]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    const bg = getBackgroundLocation(location);
    const agState = useAccountStore.getState();
    const qwState = useQianwenStore.getState();
    // Background quota page may have been emptied while settings was open
    if (
      isEmptyQuotaPath(
        bg.pathname,
        agState.accounts.length,
        agState.hasLoaded,
        qwState.accounts.length,
        qwState.hasLoaded
      )
    ) {
      navigate(resolveSafeQuotaFallback(agState.accounts.length, qwState.accounts.length), {
        replace: true,
      });
      return;
    }
    const routeState = location.state as SettingsRouteState | null | undefined;
    if (routeState?.fromModalTrigger) {
      navigate(-1);
      return;
    }
    navigate(`${bg.pathname}${bg.search}${bg.hash}`, { replace: true });
  }, [location, navigate]);

  const handleSelectSection = useCallback(
    (nextSection: SettingsSectionId) => {
      if (nextSection !== activeSection) {
        navigate(`/settings/${nextSection}`, {
          replace: true,
          state: location.state,
        });
      }
      if (contentScrollRef.current) {
        contentScrollRef.current.scrollTop = 0;
      }
    },
    [activeSection, location.state, navigate]
  );

  const handleSelectSearchResult = useCallback(
    (entry: SettingsSearchEntry) => {
      setSearchQuery('');
      setActiveResultIndex(0);
      setPendingAnchorId(entry.id);
      if (entry.section !== activeSection) {
        navigate(`/settings/${entry.section}`, {
          replace: true,
          state: location.state,
        });
      }
    },
    [activeSection, location.state, navigate]
  );

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveResultIndex((prev) => (prev + 1) % searchResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveResultIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = searchResults[activeResultIndex] ?? searchResults[0];
      if (chosen) {
        handleSelectSearchResult(chosen);
      }
    }
  };

  const currentDefaultShell = normalizeDefaultShell(shellEnv?.config.defaultShell);
  const customGitBashPath = shellEnv?.config.gitBashPath || '';
  const shellsByKey: Record<string, ShellAvailability> = {};
  for (const item of shellEnv?.shells || []) {
    shellsByKey[item.shell] = item;
  }
  const gitBashInfo = shellsByKey['gitbash'];

  const isSearching = searchQuery.trim().length > 0;
  const entryHighlightClass = (id: string) =>
    highlightedEntryId === id ? 'settings-entry-highlight' : '';

  const updateStatusMeta: Record<string, { label: string; badgeClass: string }> = {
    idle: {
      label: '待检查',
      badgeClass: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
    },
    checking: {
      label: '检查中',
      badgeClass: 'bg-sky-50 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300',
    },
    downloading: {
      label: '下载中',
      badgeClass: 'bg-sky-50 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300',
    },
    verifying: {
      label: '校验中',
      badgeClass: 'bg-sky-50 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300',
    },
    ready: {
      label: '可安装',
      badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300',
    },
    waiting_idle: {
      label: '等待空闲',
      badgeClass: 'bg-amber-50 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300',
    },
    installing: {
      label: '安装中',
      badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300',
    },
    up_to_date: {
      label: '已是最新',
      badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300',
    },
    error: {
      label: '检查失败',
      badgeClass: 'bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300',
    },
  };
  const installModeLabel: Record<string, string> = {
    nsis: '标准安装版',
    portable: '免安装便携版',
    dev: '开发模式',
  };
  const fmtMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const openReleasesPage = async () => {
    try {
      await api.openReleasePage(
        updateState?.releaseUrl || 'https://github.com/xiaohai-ouyang/Graviton/releases'
      );
    } catch (e) {
      useAccountStore.getState().setBanner({ type: 'error', message: parseError(e).message });
    }
  };

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
    >
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay forceMount asChild>
              <motion.div
                initial={shouldAnimate ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={shouldAnimate ? { duration: 0.14 } : { duration: 0 }}
                className="fixed inset-0 z-50 bg-settings-backdrop backdrop-blur-[4px]"
              />
            </Dialog.Overlay>

            <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
              <Dialog.Content
                forceMount
                asChild
                onEscapeKeyDown={(e) => {
                  if (
                    useAppInfoStore.getState().changelogOpen ||
                    useUpdateStore.getState().modalOpen ||
                    hasOtherDialogOpen(true)
                  ) {
                    e.preventDefault();
                    return;
                  }
                  if (searchQuery.trim().length > 0) {
                    e.preventDefault();
                    setSearchQuery('');
                    setActiveResultIndex(0);
                    searchInputRef.current?.focus();
                  }
                }}
                onPointerDownOutside={(e) => {
                  if (isFeedbackBannerEvent(e) || hasOtherDialogOpen(true)) {
                    e.preventDefault();
                  }
                }}
                onInteractOutside={(e) => {
                  if (isFeedbackBannerEvent(e) || hasOtherDialogOpen(true)) {
                    e.preventDefault();
                  }
                }}
              >
                <motion.div
                  data-settings-dialog="true"
                  initial={shouldAnimate ? { opacity: 0, scale: 0.97, y: 6 } : false}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={shouldAnimate ? { opacity: 0, scale: 0.97, y: 6 } : { opacity: 0 }}
                  transition={
                    shouldAnimate
                      ? { duration: 0.16, ease: [0.22, 1, 0.36, 1] }
                      : { duration: 0 }
                  }
                  className="pointer-events-auto flex h-[min(85dvh,700px)] min-h-[420px] w-[min(92vw,960px)] overflow-hidden rounded-2xl border border-settings-border bg-settings-surface text-foreground shadow-2xl backdrop-blur-xl antialiased focus:outline-hidden"
                >
                  {/* Left Fixed Sidebar: Search + Section Navigation */}
                  <aside className="flex w-[clamp(192px,27%,240px)] shrink-0 flex-col border-r border-settings-border bg-settings-sidebar">
                    <div className="shrink-0 p-3 pb-2">
                      <div className="relative flex items-center">
                        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500" />
                        <input
                          ref={searchInputRef}
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onKeyDown={handleSearchKeyDown}
                          placeholder="搜索设置..."
                          aria-label="搜索设置项"
                          className="h-9 w-full rounded-xl border border-settings-border bg-card/85 pr-8 pl-8 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-hidden dark:bg-neutral-900/75 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-600"
                        />
                        {searchQuery.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery('');
                              setActiveResultIndex(0);
                              searchInputRef.current?.focus();
                            }}
                            aria-label="清空搜索"
                            className="absolute right-2 flex h-5 w-5 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-1.5">
                      {!isSearching ? (
                        <nav aria-label="设置分组" className="space-y-1">
                          {SETTINGS_SECTIONS.map((item) => {
                            const Icon = item.icon;
                            const isActive = activeSection === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => handleSelectSection(item.id)}
                                aria-current={isActive ? 'page' : undefined}
                                className={`relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors ${
                                  isActive
                                    ? 'text-neutral-900 dark:text-neutral-50'
                                    : 'text-neutral-600 hover:bg-black/5 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-100'
                                }`}
                              >
                                {isActive && (
                                  <motion.span
                                    layoutId={shouldAnimate ? 'settings-nav-pill' : undefined}
                                    transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                                    className="absolute inset-0 rounded-xl border border-settings-border bg-card shadow-2xs dark:bg-neutral-800/90"
                                  />
                                )}
                                <Icon className="relative z-10 h-4 w-4 shrink-0" />
                                <span className="relative z-10 truncate">{item.label}</span>
                              </button>
                            );
                          })}
                        </nav>
                      ) : searchResults.length > 0 ? (
                        <div role="listbox" aria-label="设置搜索结果" className="space-y-1">
                          {searchResults.map((entry, idx) => {
                            const isSelected = idx === activeResultIndex;
                            const sectionLabel = SETTINGS_SECTION_MAP[entry.section].label;
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                onMouseEnter={() => setActiveResultIndex(idx)}
                                onClick={() => handleSelectSearchResult(entry)}
                                className={`w-full rounded-xl px-2.5 py-2 text-left transition-colors ${
                                  isSelected
                                    ? 'bg-card shadow-2xs ring-1 ring-settings-border dark:bg-neutral-800/90'
                                    : 'hover:bg-black/5 dark:hover:bg-white/5'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                                    {entry.title}
                                  </span>
                                  <span className="shrink-0 rounded-md bg-neutral-200/70 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-700/70 dark:text-neutral-300">
                                    {sectionLabel}
                                  </span>
                                </div>
                                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400">
                                  {entry.description}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center px-3 py-8 text-center">
                          <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
                            未找到匹配的设置项
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery('');
                              setActiveResultIndex(0);
                              searchInputRef.current?.focus();
                            }}
                            className="mt-2.5 rounded-lg border border-settings-border bg-card px-2.5 py-1 text-[11px] font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                          >
                            清空搜索
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 border-t border-settings-border px-3 py-2.5">
                      <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
                        <span>切换设置</span>
                        <kbd className="rounded border border-settings-border bg-card/80 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                          Ctrl + ,
                        </kbd>
                      </div>
                    </div>
                  </aside>

                  {/* Right Scrollable Content */}
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-settings-border px-6 py-4">
                      <div className="min-w-0">
                        <Dialog.Title className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                          {activeSectionMeta.title}
                        </Dialog.Title>
                        <Dialog.Description className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                          {activeSectionMeta.subtitle}
                        </Dialog.Description>
                      </div>

                      <Dialog.Close asChild>
                        <button
                          type="button"
                          aria-label="关闭设置"
                          title="关闭设置 (Esc)"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </Dialog.Close>
                    </header>

                    <div
                      ref={contentScrollRef}
                      className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5"
                    >
                      {activeSection === 'providers' && (
                        <ProvidersSettingsSection
                          entryHighlightClass={entryHighlightClass}
                          onNavigateToQuota={(path) => navigate(path, { replace: true })}
                        />
                      )}

                      {activeSection === 'general' && (
                        <>
                          <section className="rounded-2xl border border-neutral-200/80 bg-card/90 p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
                            <div
                              data-settings-entry-id="theme"
                              className={`-m-2 flex flex-wrap items-center justify-between gap-4 p-2 transition-colors ${entryHighlightClass('theme')}`}
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                                  <Palette className="h-4 w-4" />
                                </div>
                                <div>
                                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                    界面外观
                                  </h3>
                                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                    选择跟随系统、浅色或深色主题模式
                                  </p>
                                </div>
                              </div>
                              <ThemeToggle />
                            </div>

                            <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
                              <div
                                data-settings-entry-id="motion"
                                className={`-m-2 flex flex-wrap items-center justify-between gap-4 p-2 transition-colors ${entryHighlightClass('motion')}`}
                              >
                                <div className="flex items-center gap-2.5">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                                    <WandSparkles className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                      过渡动效
                                    </h3>
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                      {motionMode === 'auto'
                                        ? autoReason
                                        : motionMode === 'full'
                                        ? '已开启页面切换、列表展开收缩与排序过渡效果'
                                        : '已关闭界面过渡效果，采用零延迟即时响应'}
                                    </p>
                                  </div>
                                </div>
                                <MotionToggle />
                              </div>
                            </div>

                            <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
                              <div
                                data-settings-entry-id="reset-time"
                                className={`-m-2 flex flex-wrap items-center justify-between gap-4 p-2 transition-colors ${entryHighlightClass('reset-time')}`}
                              >
                                <div className="flex items-center gap-2.5">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                                    <Clock className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                      重置时间格式
                                    </h3>
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                      {resetTimeFormat === 'countdown'
                                        ? '显示距离重置的剩余倒计时（如“还有6天5小时重置”），悬停可查看精确时间'
                                        : '显示具体重置时间点（如“11月29日 06:38 重置”），悬停可查看剩余倒计时'}
                                    </p>
                                  </div>
                                </div>
                                <ResetTimeModeToggle />
                              </div>
                            </div>
                          </section>

                          <section className="rounded-2xl border border-neutral-200/80 bg-card/90 p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
                            <div
                              data-settings-entry-id="widget-top"
                              className={`-m-2 flex flex-wrap items-center justify-between gap-4 p-2 transition-colors ${entryHighlightClass('widget-top')}`}
                            >
                              <div className="flex items-center gap-2.5">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                                  <Layers className="h-4 w-4" />
                                </div>
                                <div>
                                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                    悬浮窗
                                  </h3>
                                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                    控制桌面悬浮窗是否始终置顶于其他窗口之上（关闭后可避免遮挡鼠标点击）
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={widgetAlwaysOnTop}
                                aria-label="悬浮窗置顶"
                                onClick={() => void setWidgetAlwaysOnTop(!widgetAlwaysOnTop)}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-hidden ${
                                  widgetAlwaysOnTop
                                    ? 'bg-neutral-900 dark:bg-neutral-100'
                                    : 'bg-neutral-200 dark:bg-neutral-700'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform dark:bg-neutral-900 ${
                                    widgetAlwaysOnTop ? 'translate-x-5' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>
                          </section>
                        </>
                      )}

                      {activeSection === 'environment' && (
                        <>
                          <section className="rounded-2xl border border-neutral-200/80 bg-card/90 p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
                            <div
                              data-settings-entry-id="client-path"
                              className={`-m-2 p-2 transition-colors ${entryHighlightClass('client-path')}`}
                            >
                              <div className="flex items-center gap-2.5 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                                  <MonitorCheck className="h-4 w-4" />
                                </div>
                                <div>
                                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                    客户端路径
                                  </h3>
                                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                    默认自动探测本机运行进程或标准安装目录。若安装于非标准目录，可在此手动指定。
                                  </p>
                                </div>
                              </div>

                              <div className="mt-4">
                                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                                  Antigravity 可执行文件路径
                                </label>
                                <div className="mt-2 flex gap-2">
                                  <input
                                    type="text"
                                    readOnly
                                    value={clientPath || '自动探测 (默认路径)'}
                                    placeholder="未指定自定义路径，系统将自动探测"
                                    className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-800 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
                                  />
                                  <button
                                    type="button"
                                    onClick={selectClientPath}
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-card px-3.5 py-2 text-xs font-medium text-neutral-700 shadow-xs transition-colors hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                                  >
                                    <FolderOpen className="h-3.5 w-3.5" />
                                    <span>浏览...</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </section>

                          <section className="rounded-2xl border border-neutral-200/80 bg-card/90 p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
                            <div
                              data-settings-entry-id="default-shell"
                              className={`-m-2 p-2 transition-colors ${entryHighlightClass('default-shell')}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
                                <div className="flex items-center gap-2.5">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                                    <Terminal className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                      命令执行环境（Shell）
                                    </h3>
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                      Windows 默认优先使用 PowerShell；未单独指定环境的指令（含扫描与 AI 优化指令）均跟随全局默认。
                                    </p>
                                  </div>
                                </div>

                                <div
                                  role="radiogroup"
                                  aria-label="默认执行 Shell 切换"
                                  className="inline-flex items-center rounded-lg border border-neutral-200 bg-neutral-100/90 p-0.5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/90"
                                >
                                  {SHELL_ORDER.map((shellKey) => {
                                    const isActive = currentDefaultShell === shellKey;
                                    const info = shellsByKey[shellKey];
                                    const meta = SHELL_META[shellKey];
                                    return (
                                      <button
                                        key={shellKey}
                                        type="button"
                                        role="radio"
                                        aria-checked={isActive}
                                        disabled={savingShell}
                                        title={info?.detail || meta.label}
                                        onClick={async () => {
                                          if (isActive || savingShell) return;
                                          setSavingShell(true);
                                          await saveShellConfig({
                                            defaultShell: shellKey,
                                            gitBashPath: customGitBashPath,
                                          });
                                          setSavingShell(false);
                                        }}
                                        className={`relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                                          isActive
                                            ? 'font-semibold text-neutral-900 dark:text-neutral-50'
                                            : 'font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
                                        }`}
                                      >
                                        {isActive && (
                                          <motion.span
                                            layoutId={shouldAnimate ? 'default-shell-active-pill' : undefined}
                                            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                                            className="absolute inset-0 rounded-md bg-card shadow-2xs dark:bg-neutral-800"
                                          />
                                        )}
                                        <span className="relative z-10 inline-flex items-center gap-1.5">
                                          <span
                                            className={`h-1.5 w-1.5 rounded-full ${
                                              info?.available ?? true
                                                ? 'bg-emerald-500 dark:bg-emerald-400'
                                                : 'bg-amber-500 dark:bg-amber-400'
                                            }`}
                                          />
                                          <span>{meta.label}</span>
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {shellEnv?.shells && shellEnv.shells.length > 0 && (
                                <div className="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                  {shellEnv.shells.map((item) => (
                                    <div
                                      key={item.shell}
                                      className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-800/40"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                                          {item.label}
                                        </span>
                                        <span
                                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                            item.available
                                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                              : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                                          }`}
                                        >
                                          {item.available ? '可用' : '未就绪'}
                                        </span>
                                      </div>
                                      <p
                                        className="mt-0.5 truncate text-[11px] text-neutral-500 dark:text-neutral-400"
                                        title={item.path || item.detail}
                                      >
                                        {item.detail}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-800">
                              <div
                                data-settings-entry-id="git-bash-path"
                                className={`-m-2 p-2 transition-colors ${entryHighlightClass('git-bash-path')}`}
                              >
                                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                                  Git Bash 可执行文件路径（bash.exe，可选）
                                </label>
                                <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                                  默认自动探测本机 Git for Windows 安装路径与 PATH（自动排除 WSL System32\bash.exe）；若安装在非标准位置可在此指定。
                                </p>
                                <div className="mt-2 flex gap-2">
                                  <input
                                    type="text"
                                    readOnly
                                    value={
                                      customGitBashPath ||
                                      (gitBashInfo?.available && gitBashInfo.path
                                        ? `自动探测 (${gitBashInfo.path})`
                                        : '自动探测 (未检测到可用的 Git Bash)')
                                    }
                                    className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void selectGitBashPath()}
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-card px-3.5 py-2 text-xs font-medium text-neutral-700 shadow-xs transition-colors hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                                  >
                                    <FolderOpen className="h-3.5 w-3.5" />
                                    <span>浏览...</span>
                                  </button>
                                  {customGitBashPath && (
                                    <button
                                      type="button"
                                      onClick={() => void resetGitBashPath()}
                                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-card px-3 py-2 text-xs font-medium text-neutral-600 shadow-xs transition-colors hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                      <span>恢复自动</span>
                                    </button>
                                  )}
                                </div>
                                {gitBashInfo && !gitBashInfo.available && (
                                  <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                                    当前状态：{gitBashInfo.detail}。如需执行 Git Bash 指令，请安装 Git for Windows 或手动选择 Git\bin\bash.exe。
                                  </p>
                                )}
                              </div>
                            </div>
                          </section>
                        </>
                      )}

                      {activeSection === 'ai' && (
                        <section className="rounded-2xl border border-neutral-200/80 bg-card/90 p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
                          <div
                            data-settings-entry-id="ai-assistant"
                            className={`-m-2 p-2 transition-colors ${entryHighlightClass('ai-assistant')}`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
                              <div className="flex items-center gap-2.5">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                                  <Sparkles className="h-4 w-4" />
                                </div>
                                <div>
                                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                    轻量 AI 指令助手（可选）
                                  </h3>
                                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                    配置 OpenAI 兼容接口（如 DeepSeek、Gemini、Ollama），导入项目时后台自动优化中文命名与核心指令推荐
                                  </p>
                                </div>
                              </div>

                              <button
                                type="button"
                                role="switch"
                                aria-checked={aiForm.enabled}
                                aria-label="启用 AI 助手"
                                onClick={() => setAiForm((f) => ({ ...f, enabled: !f.enabled }))}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-hidden ${
                                  aiForm.enabled
                                    ? 'bg-neutral-900 dark:bg-neutral-100'
                                    : 'bg-neutral-200 dark:bg-neutral-700'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform dark:bg-neutral-900 ${
                                    aiForm.enabled ? 'translate-x-5' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                              <div className="sm:col-span-2">
                                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                                  Base URL
                                </label>
                                <input
                                  type="text"
                                  value={aiForm.baseUrl}
                                  onChange={(e) => setAiForm((f) => ({ ...f, baseUrl: e.target.value }))}
                                  placeholder="https://api.openai.com/v1 或 http://localhost:11434/v1"
                                  className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
                                />
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                                  API Key
                                </label>
                                <div className="relative mt-1.5">
                                  <input
                                    type={showKey ? 'text' : 'password'}
                                    value={aiForm.apiKey}
                                    onChange={(e) => setAiForm((f) => ({ ...f, apiKey: e.target.value }))}
                                    placeholder="sk-...（本地 Ollama 可留空）"
                                    className="w-full rounded-lg border border-neutral-200 bg-neutral-50 py-2 pr-9 pl-3 font-mono text-xs text-neutral-800 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setShowKey((v) => !v)}
                                    aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                                    className="absolute inset-y-0 right-2 flex items-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                                  >
                                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                  </button>
                                </div>
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                                  模型名称
                                </label>
                                <input
                                  type="text"
                                  value={aiForm.model}
                                  onChange={(e) => setAiForm((f) => ({ ...f, model: e.target.value }))}
                                  placeholder="gpt-4o-mini / deepseek-chat / qwen2.5:7b"
                                  className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
                                />
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                                API Key 加密存储于本机 Windows 凭据管理器
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={testingAI}
                                  onClick={async () => {
                                    setTestingAI(true);
                                    await testAIConfig(aiForm);
                                    setTestingAI(false);
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-card px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                                >
                                  {testingAI && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                  <span>测试连接</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={savingAI}
                                  onClick={async () => {
                                    setSavingAI(true);
                                    await saveAIConfig(aiForm);
                                    setSavingAI(false);
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                                >
                                  {savingAI ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Check className="h-3.5 w-3.5" />
                                  )}
                                  <span>保存配置</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        </section>
                      )}

                      {activeSection === 'about' && (
                        <>
                          <section className="rounded-2xl border border-neutral-200/80 bg-card/90 p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
                            <div
                              data-settings-entry-id="app-update"
                              className={`-m-2 p-2 transition-colors ${entryHighlightClass('app-update')}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
                                <div className="flex items-center gap-2.5">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                                    <Download className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                        应用更新
                                      </h3>
                                      {updateState && (
                                        <span
                                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                                            (updateStatusMeta[updateState.status] || updateStatusMeta.idle)
                                              .badgeClass
                                          }`}
                                        >
                                          {
                                            (updateStatusMeta[updateState.status] || updateStatusMeta.idle)
                                              .label
                                          }
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                      基于 GitHub Releases 的自动检查、后台下载与重启安装（强制 SHA-256 校验）
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  {updateState?.status === 'downloading' ||
                                  updateState?.status === 'verifying' ? (
                                    <div className="flex min-w-44 items-center gap-2">
                                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                                        <div
                                          className={`h-full rounded-full bg-neutral-900 transition-[width] dark:bg-neutral-100 ${
                                            updateState.status === 'downloading' &&
                                            updateState.totalBytes <= 0
                                              ? 'animate-pulse opacity-70'
                                              : ''
                                          }`}
                                          style={{
                                            width:
                                              updateState.totalBytes > 0
                                                ? `${updateState.progress}%`
                                                : '100%',
                                          }}
                                        />
                                      </div>
                                      <span className="shrink-0 font-mono text-[11px] text-neutral-600 dark:text-neutral-300">
                                        {updateState.status === 'verifying'
                                          ? '校验中…'
                                          : updateState.totalBytes > 0
                                            ? `${fmtMB(updateState.downloadedBytes)} / ${fmtMB(updateState.totalBytes)} · ${updateState.progress}%`
                                            : `已下载 ${fmtMB(updateState.downloadedBytes)}`}
                                      </span>
                                    </div>
                                  ) : updateState?.status === 'ready' ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => setUpdateModalOpen(true)}
                                        className="rounded-lg border border-neutral-300 bg-card px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                                      >
                                        查看详情
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void requestInstall()}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                        立即重启更新
                                      </button>
                                    </>
                                  ) : updateState?.status === 'waiting_idle' ? (
                                    <>
                                      <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                                        <Hourglass className="h-3.5 w-3.5" />
                                        等待任务结束后自动重启
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => void cancelDeferred()}
                                        className="rounded-lg border border-neutral-300 bg-card px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                                      >
                                        取消预约
                                      </button>
                                    </>
                                  ) : updateState?.status === 'error' ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => void openReleasesPage()}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-card px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        前往 GitHub Releases
                                      </button>
                                      <button
                                        type="button"
                                        disabled={updateChecking}
                                        onClick={() => void checkForUpdates()}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                                      >
                                        {updateChecking ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <RefreshCw className="h-3.5 w-3.5" />
                                        )}
                                        重试
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={updateChecking || updateState?.status === 'checking'}
                                      onClick={() => void checkForUpdates()}
                                      className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                                    >
                                      {updateChecking || updateState?.status === 'checking' ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <RefreshCw className="h-3.5 w-3.5" />
                                      )}
                                      检查更新
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                                <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                                    当前版本
                                  </div>
                                  <div className="mt-1 font-mono text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                                    v{updateState?.currentVersion || appInfo?.version || '-'}
                                  </div>
                                </div>
                                <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                                    运行形态
                                  </div>
                                  <div className="mt-1 text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                                    {installModeLabel[updateState?.installMode || ''] || '-'}
                                  </div>
                                </div>
                                <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                                    上次检查
                                  </div>
                                  <div className="mt-1 text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                                    {updateState?.checkedAt
                                      ? new Date(updateState.checkedAt).toLocaleString()
                                      : '尚未检查'}
                                  </div>
                                </div>
                              </div>

                              {updateState?.status === 'error' && updateState.errorMessage && (
                                <div className="mt-3 rounded-xl border border-rose-200/80 bg-rose-50 px-3 py-2.5 text-xs text-rose-700 dark:border-rose-800/70 dark:bg-rose-950/50 dark:text-rose-300">
                                  {updateState.errorMessage}
                                </div>
                              )}
                              {updateState?.installMode === 'dev' && (
                                <div className="mt-3 rounded-xl border border-sky-200/80 bg-sky-50 px-3 py-2.5 text-xs text-sky-700 dark:border-sky-800/70 dark:bg-sky-950/50 dark:text-sky-300">
                                  开发模式仅支持检查预览，不会覆盖开发二进制；自动安装请使用正式构建版本
                                </div>
                              )}

                              {/* Auto check switch */}
                              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3.5 py-3 dark:border-neutral-800 dark:bg-neutral-800/40">
                                <div>
                                  <div className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
                                    自动检查并后台下载更新
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                                    启动后延迟检查，之后每 6 小时检查一次；下载完成后等待您手动确认重启
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={updateState?.autoCheckEnabled ?? true}
                                  aria-label="自动检查并后台下载更新"
                                  disabled={savingUpdateSettings || !updateState}
                                  onClick={() =>
                                    updateState &&
                                    void saveUpdateSettings(
                                      !updateState.autoCheckEnabled,
                                      updateState.mirrorUrl || ''
                                    )
                                  }
                                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-hidden disabled:opacity-60 ${
                                    (updateState?.autoCheckEnabled ?? true)
                                      ? 'bg-neutral-900 dark:bg-neutral-100'
                                      : 'bg-neutral-200 dark:bg-neutral-700'
                                  }`}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform dark:bg-neutral-900 ${
                                      (updateState?.autoCheckEnabled ?? true)
                                        ? 'translate-x-5'
                                        : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              </div>

                              {/* Mirror prefix */}
                              <div className="mt-3">
                                <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                                  GitHub 加速镜像前缀（可选）
                                </label>
                                <div className="mt-1.5 flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={mirrorInput}
                                    onChange={(e) => setMirrorInput(e.target.value)}
                                    placeholder="https://gh-proxy.com/"
                                    className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
                                  />
                                  <button
                                    type="button"
                                    disabled={savingUpdateSettings || !updateState}
                                    onClick={() =>
                                      updateState &&
                                      void saveUpdateSettings(updateState.autoCheckEnabled, mirrorInput)
                                    }
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-card px-3 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                                  >
                                    {savingUpdateSettings ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Check className="h-3.5 w-3.5" />
                                    )}
                                    保存
                                  </button>
                                </div>
                                <p className="mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                                  留空直连 GitHub；镜像仅用于加速下载，安装前仍强制校验官方 SHA-256，篡改包会被拒绝
                                </p>
                              </div>
                            </div>
                          </section>

                          <section className="rounded-2xl border border-neutral-200/80 bg-card/90 p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
                            <div
                              data-settings-entry-id="data-security"
                              className={`-m-2 p-2 transition-colors ${entryHighlightClass('data-security')}`}
                            >
                              <div className="flex items-center gap-2.5 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                                  <Shield className="h-4 w-4" />
                                </div>
                                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                  数据与安全说明
                                </h3>
                              </div>

                              <ul className="mt-3.5 list-inside list-disc space-y-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                                <li>
                                  账号与额度持久化于{' '}
                                  <code className="rounded bg-neutral-200/70 px-1.5 py-0.5 text-[11px] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                                    %LOCALAPPDATA%\Graviton
                                  </code>
                                </li>
                                <li>敏感 Token 仅保存在本机 Windows 凭据管理器，不会上传至第三方服务器</li>
                                <li>纯粹合规、轻量原生：仅提供额度查询、账号导入与本地切号，绝不包含反代功能</li>
                              </ul>
                            </div>
                          </section>

                          <section className="rounded-2xl border border-neutral-200/80 bg-card/90 p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
                            <div
                              data-settings-entry-id="about-version"
                              className={`-m-2 p-2 transition-colors ${entryHighlightClass('about-version')}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
                                <div className="flex items-center gap-2.5">
                                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                                    <FileClock className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                                        关于与更新日志
                                      </h3>
                                      {appInfo && (
                                        <>
                                          <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                                            v{appInfo.version}
                                          </span>
                                          <span
                                            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                                              (CHANNEL_META[appInfo.channel] || CHANNEL_META.dev).badgeClass
                                            }`}
                                          >
                                            {(CHANNEL_META[appInfo.channel] || CHANNEL_META.dev).label}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                      查看当前构建元数据与各版本功能演进记录
                                    </p>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={openChangelog}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-card px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-2xs transition-colors hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                                >
                                  <FileClock className="h-3.5 w-3.5" />
                                  <span>弹窗查看完整日志</span>
                                </button>
                              </div>

                              {appInfo && (
                                <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                                  <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                                      当前版本
                                    </div>
                                    <div className="mt-1 font-mono text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                                      v{appInfo.version}
                                    </div>
                                  </div>
                                  <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                                    <div className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                                      <GitCommitHorizontal className="h-3 w-3" />
                                      <span>构建提交</span>
                                    </div>
                                    <div className="mt-1 font-mono text-xs font-medium text-neutral-800 dark:text-neutral-200">
                                      {appInfo.commit === 'dev' ? '本地开发构建' : appInfo.commit}
                                    </div>
                                  </div>
                                  <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                                    <div className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                                      <Clock className="h-3 w-3" />
                                      <span>构建时间</span>
                                    </div>
                                    <div className="mt-1 truncate font-mono text-xs font-medium text-neutral-800 dark:text-neutral-200">
                                      {appInfo.buildTime === 'dev'
                                        ? '未注入（开发模式）'
                                        : new Date(appInfo.buildTime).toLocaleString()}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>

                            {changelog.length > 0 && (
                              <div
                                data-settings-entry-id="changelog"
                                className={`-mx-2 mt-4 space-y-2.5 p-2 transition-colors ${entryHighlightClass('changelog')}`}
                              >
                                {changelog.map((release, index) => {
                                  const isExpanded =
                                    expandedReleases[release.version] ?? index === 0;
                                  const relChannel =
                                    CHANNEL_META[release.channel] || CHANNEL_META.stable;

                                  return (
                                    <div
                                      key={release.version}
                                      className="overflow-hidden rounded-xl border border-neutral-200/80 dark:border-neutral-800"
                                    >
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedReleases((prev) => ({
                                            ...prev,
                                            [release.version]: !isExpanded,
                                          }))
                                        }
                                        className="flex w-full items-center justify-between gap-3 bg-neutral-50/70 px-3.5 py-2.5 text-left transition-colors hover:bg-neutral-100/80 dark:bg-neutral-800/40 dark:hover:bg-neutral-800/70"
                                      >
                                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                                          <span className="font-mono text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                                            v{release.version}
                                          </span>
                                          <span
                                            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${relChannel.badgeClass}`}
                                          >
                                            {relChannel.label}
                                          </span>
                                          {release.title && (
                                            <span className="truncate text-xs text-neutral-600 dark:text-neutral-300">
                                              {release.title}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                                          <span className="inline-flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            {release.date}
                                          </span>
                                          <ChevronDown
                                            className={`h-3.5 w-3.5 transition-transform ${
                                              isExpanded ? 'rotate-180' : ''
                                            }`}
                                          />
                                        </div>
                                      </button>

                                      <AnimatePresence initial={false}>
                                        {isExpanded && (
                                          <motion.div
                                            key="content"
                                            initial={shouldAnimate ? { height: 0, opacity: 0 } : false}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={shouldAnimate ? { height: 0, opacity: 0 } : { opacity: 0 }}
                                            transition={
                                              shouldAnimate
                                                ? { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
                                                : { duration: 0 }
                                            }
                                            className="overflow-hidden"
                                          >
                                            <div className="border-t border-neutral-200/70 px-3.5 py-3 dark:border-neutral-800">
                                              {release.summary && (
                                                <p className="mb-2.5 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                                                  {release.summary}
                                                </p>
                                              )}
                                              <ul className="space-y-1.5">
                                                {release.changes.map((c, idx) => (
                                                  <ChangeItemRow
                                                    key={`${release.version}-settings-${idx}`}
                                                    change={c}
                                                  />
                                                ))}
                                              </ul>
                                            </div>
                                          </motion.div>
                                        )}
                                      </AnimatePresence>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
