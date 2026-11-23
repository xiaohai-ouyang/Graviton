import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  Download,
  FileClock,
  Gauge,
  Hourglass,
  Layers,
  LayoutGrid,
  Loader2,
  RotateCcw,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ProviderLogo } from './ProviderLogo';
import { ThemeToggle } from './ThemeToggle';
import { useAccountStore } from '../store/useAccountStore';
import { useAppInfoStore } from '../store/useAppInfoStore';
import { useDeepSeekStore } from '../store/useDeepSeekStore';
import { useMotionStore } from '../store/useMotionStore';
import { useQianwenStore } from '../store/useQianwenStore';
import {
  getBackgroundLocation,
  isEmptyQuotaPath,
  isSettingsPath,
  openSettingsModal,
  resolveSafeQuotaFallback,
  SettingsRouteState,
  useSettingsModalStore,
} from '../store/useSettingsModalStore';
import { useUpdateStore } from '../store/useUpdateStore';

export const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [quotaExpanded, setQuotaExpanded] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  const agCount = useAccountStore((s) => s.accounts.length);
  const qwCount = useQianwenStore((s) => s.accounts.length);
  const dsCount = useDeepSeekStore((s) => s.accounts.length);
  const { appInfo, openChangelog } = useAppInfoStore();
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);
  const lastSection = useSettingsModalStore((s) => s.lastSection);
  const updateState = useUpdateStore((s) => s.state);
  const setUpdateModalOpen = useUpdateStore((s) => s.setModalOpen);

  const backgroundLocation = getBackgroundLocation(location);
  const settingsOpen = isSettingsPath(location.pathname);
  const isOverviewActive = backgroundLocation.pathname === '/overview';
  const isQuotaRoute = backgroundLocation.pathname.startsWith('/quota');
  const isEnvActive = backgroundLocation.pathname === '/env';

  const navigateMainRoute = (to: string) => {
    if (settingsOpen || backgroundLocation.pathname !== to) {
      navigate(to);
    }
  };

  const handleToggleSettings = () => {
    if (settingsOpen) {
      const agState = useAccountStore.getState();
      const qwState = useQianwenStore.getState();
      const dsState = useDeepSeekStore.getState();
      // Background quota page may have been emptied while settings was open
      if (
        isEmptyQuotaPath(
          backgroundLocation.pathname,
          agState.accounts.length,
          agState.hasLoaded,
          qwState.accounts.length,
          qwState.hasLoaded,
          dsState.accounts.length,
          dsState.hasLoaded
        )
      ) {
        navigate(
          resolveSafeQuotaFallback(
            agState.accounts.length,
            qwState.accounts.length,
            dsState.accounts.length
          ),
          { replace: true }
        );
        return;
      }
      const routeState = location.state as SettingsRouteState | null | undefined;
      if (routeState?.fromModalTrigger) {
        navigate(-1);
      } else {
        navigate(
          `${backgroundLocation.pathname}${backgroundLocation.search}${backgroundLocation.hash}`,
          { replace: true }
        );
      }
      return;
    }

    navigate(`/settings/${lastSection}`, {
      state: {
        backgroundLocation,
        fromModalTrigger: true,
      } satisfies SettingsRouteState,
    });
  };

  const allQuotaProviders = [
    { id: 'antigravity', to: '/quota/antigravity', label: 'Antigravity', count: agCount },
    { id: 'qianwen', to: '/quota/qianwen', label: '千问', count: qwCount },
    { id: 'deepseek', to: '/quota/deepseek', label: 'DeepSeek', count: dsCount },
  ] as const;
  const connectedQuotaProviders = allQuotaProviders.filter((p) => p.count > 0);

  const updateStatus = updateState?.status;
  const updateReady = updateStatus === 'ready';
  const updateInstalling = updateStatus === 'installing';
  const updateInstalled = updateStatus === 'installed';
  const updateWaiting = updateStatus === 'waiting_idle';
  const updateDownloading = updateStatus === 'downloading' || updateStatus === 'verifying';
  const updateActive = updateReady || updateInstalling || updateInstalled || updateWaiting;

  return (
    <aside
      className={`sticky top-0 z-20 flex h-screen shrink-0 flex-col border-r border-neutral-200/80 bg-card/85 backdrop-blur-md transition-[width] duration-200 dark:border-neutral-800 dark:bg-neutral-900/85 ${
        collapsed ? 'w-16' : 'w-52'
      }`}
    >
      {/* Brand Header (click to toggle sidebar) */}
      <div
        className={`flex h-16 items-center border-b border-neutral-200/70 px-3.5 dark:border-neutral-800/80 ${
          collapsed ? 'justify-center' : ''
        }`}
      >
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          title={collapsed ? '点击展开侧边栏' : '点击收起侧边栏'}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className={`group flex items-center gap-2.5 overflow-hidden rounded-xl text-left transition-opacity hover:opacity-85 active:scale-[0.98] ${
            collapsed ? 'justify-center' : 'w-full'
          }`}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-xs dark:bg-neutral-100 dark:text-neutral-900">
            <ShieldCheck className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                Graviton
              </h1>
              <p className="truncate text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
                Antigravity 轻量管理
              </p>
            </div>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav aria-label="主导航" className="flex-1 space-y-1 p-2.5">
        {/* 概览 */}
        <button
          type="button"
          onClick={() => navigateMainRoute('/overview')}
          aria-current={isOverviewActive ? 'page' : undefined}
          title={collapsed ? '概览' : undefined}
          className={`relative flex w-full items-center rounded-lg text-xs font-medium transition-colors ${
            collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2.5'
          } ${
            isOverviewActive
              ? 'text-white dark:text-neutral-900'
              : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-100'
          }`}
        >
          {isOverviewActive && (
            <motion.span
              layoutId={shouldAnimate ? 'sidebar-nav-pill' : undefined}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="inset-0 absolute rounded-lg bg-neutral-900 shadow-xs dark:bg-neutral-100"
            />
          )}
          <LayoutGrid className="relative z-10 h-4 w-4 shrink-0" />
          {!collapsed && <span className="relative z-10 truncate">概览</span>}
        </button>

        {/* 额度（支持展开提供商子菜单） */}
        <div className="space-y-1">
          <button
            type="button"
            title={collapsed ? '额度' : undefined}
            aria-expanded={!collapsed ? quotaExpanded : undefined}
            onClick={() => {
              if (collapsed) {
                if (connectedQuotaProviders.length > 0) {
                  navigateMainRoute(connectedQuotaProviders[0].to);
                } else {
                  openSettingsModal(navigate, location, 'providers');
                }
              } else {
                setQuotaExpanded((prev) => !prev);
              }
            }}
            className={`relative flex w-full items-center rounded-lg text-xs font-medium transition-colors ${
              collapsed ? 'justify-center px-2 py-2.5' : 'justify-between px-3 py-2.5'
            } ${
              collapsed && isQuotaRoute
                ? 'text-white dark:text-neutral-900'
                : isQuotaRoute
                  ? 'text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-100'
            }`}
          >
            {collapsed && isQuotaRoute && (
              <motion.span
                layoutId={shouldAnimate ? 'sidebar-nav-pill' : undefined}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="inset-0 absolute rounded-lg bg-neutral-900 shadow-xs dark:bg-neutral-100"
              />
            )}
            <span className="relative z-10 flex items-center gap-2.5 truncate">
              <Gauge className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">额度</span>}
            </span>
            {!collapsed && (
              <ChevronDown
                className={`relative z-10 h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform duration-150 ${
                  quotaExpanded ? 'rotate-0' : '-rotate-90'
                }`}
              />
            )}
          </button>

          {!collapsed && (
            <AnimatePresence initial={false}>
              {quotaExpanded && (
                <motion.div
                  initial={shouldAnimate ? { opacity: 0, height: 0 } : false}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={shouldAnimate ? { opacity: 0, height: 0 } : { opacity: 0 }}
                  transition={shouldAnimate ? { duration: 0.15 } : { duration: 0 }}
                  className="ml-3 space-y-0.5 overflow-hidden border-l border-neutral-200/80 pl-2.5 dark:border-neutral-800"
                >
                  {connectedQuotaProviders.length === 0 && (
                    <div className="rounded-lg px-2.5 py-2">
                      <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                        暂未连接供应商
                      </p>
                      <button
                        type="button"
                        onClick={() => openSettingsModal(navigate, location, 'providers')}
                        className="mt-1.5 inline-flex items-center rounded-md border border-neutral-200 bg-card px-2 py-1 text-[11px] font-medium text-neutral-600 shadow-2xs transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                      >
                        前往设置连接
                      </button>
                    </div>
                  )}
                  {connectedQuotaProviders.map((provider) => {
                    const isActive = backgroundLocation.pathname === provider.to;
                    return (
                      <button
                        key={provider.to}
                        type="button"
                        onClick={() => navigateMainRoute(provider.to)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`relative flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${
                          isActive
                            ? 'text-white dark:text-neutral-900'
                            : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-100'
                        }`}
                      >
                        {isActive && (
                          <motion.span
                            layoutId={shouldAnimate ? 'sidebar-nav-pill' : undefined}
                            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                            className="inset-0 absolute rounded-lg bg-neutral-900 shadow-xs dark:bg-neutral-100"
                          />
                        )}
                        <span className="relative z-10 flex min-w-0 items-center gap-2">
                          <ProviderLogo provider={provider.id} size="xs" />
                          <span className="truncate">{provider.label}</span>
                        </span>
                        <span
                          className={`relative z-10 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            isActive
                              ? 'bg-white/20 text-white dark:bg-neutral-900/15 dark:text-neutral-900'
                              : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                          }`}
                        >
                          {provider.count}
                        </span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {/* 环境 */}
        <button
          type="button"
          onClick={() => navigateMainRoute('/env')}
          aria-current={isEnvActive ? 'page' : undefined}
          title={collapsed ? '环境' : undefined}
          className={`relative flex w-full items-center rounded-lg text-xs font-medium transition-colors ${
            collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2.5'
          } ${
            isEnvActive
              ? 'text-white dark:text-neutral-900'
              : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-100'
          }`}
        >
          {isEnvActive && (
            <motion.span
              layoutId={shouldAnimate ? 'sidebar-nav-pill' : undefined}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="inset-0 absolute rounded-lg bg-neutral-900 shadow-xs dark:bg-neutral-100"
            />
          )}
          <Layers className="relative z-10 h-4 w-4 shrink-0" />
          {!collapsed && <span className="relative z-10 truncate">环境</span>}
        </button>
      </nav>

      {/* Footer Utilities */}
      <div
        className={`border-t border-neutral-200/70 p-2.5 dark:border-neutral-800/80 ${
          collapsed ? 'flex flex-col items-center gap-2' : 'space-y-2'
        }`}
      >
        <div
          className={
            collapsed ? '' : 'flex items-center justify-between px-1'
          }
        >
          {!collapsed && (
            <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
              界面主题
            </span>
          )}
          <ThemeToggle compact={collapsed} />
        </div>

        <button
          type="button"
          onClick={handleToggleSettings}
          aria-pressed={settingsOpen}
          title={collapsed ? '设置 (Ctrl+,)' : '快捷键 Ctrl+,'}
          className={`flex items-center rounded-lg text-xs font-medium transition-colors ${
            collapsed ? 'h-9 w-9 justify-center' : 'w-full gap-2.5 px-3 py-2'
          } ${
            settingsOpen
              ? 'bg-neutral-900 text-white shadow-xs dark:bg-neutral-100 dark:text-neutral-900'
              : 'border border-neutral-200 bg-card text-neutral-700 shadow-2xs hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
          }`}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">设置</span>}
        </button>

        {appInfo && (
          <button
            type="button"
            onClick={updateActive ? () => setUpdateModalOpen(true) : openChangelog}
            title={
              updateInstalled
                ? `新版本 v${updateState?.latestVersion} 已安装完成 — 点击重启应用`
                : updateWaiting
                  ? `v${updateState?.latestVersion} 已安装完成 — 等待任务结束后重启`
                  : updateInstalling
                    ? `正在安装更新 v${updateState?.latestVersion}…`
                    : updateReady
                      ? `新版本 v${updateState?.latestVersion} 已下载 — 点击安装更新`
                      : updateDownloading
                        ? `正在下载更新 ${updateState?.progress ?? 0}%`
                        : `Graviton v${appInfo.version} — 点击查看更新日志`
            }
            className={`relative flex items-center rounded-lg text-[11px] font-medium transition-colors ${
              updateInstalled
                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60'
                : updateWaiting
                  ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-900/60'
                  : updateReady || updateInstalling
                    ? 'bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/60 dark:text-sky-300 dark:hover:bg-sky-900/60'
                    : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-100'
            } ${
              collapsed
                ? 'h-8 w-9 justify-center'
                : 'w-full justify-between px-2.5 py-1.5'
            }`}
          >
            {collapsed ? (
              <>
                {updateInstalled ? (
                  <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                ) : updateWaiting ? (
                  <Hourglass className="h-3.5 w-3.5 shrink-0" />
                ) : updateInstalling ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : updateReady ? (
                  <Download className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <FileClock className="h-3.5 w-3.5 shrink-0" />
                )}
                {(updateInstalled || updateReady || updateDownloading) && (
                  <span
                    className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                      updateInstalled ? 'bg-emerald-500' : 'bg-sky-500'
                    }`}
                  />
                )}
              </>
            ) : updateInstalled ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">重启应用 v{updateState?.latestVersion}</span>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              </span>
            ) : updateWaiting ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Hourglass className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">等待空闲重启</span>
              </span>
            ) : updateInstalling ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                <span className="truncate">正在安装更新…</span>
              </span>
            ) : updateReady ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Download className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">安装更新 v{updateState?.latestVersion}</span>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
              </span>
            ) : (
              <>
                <span className="inline-flex min-w-0 items-center gap-1.5 font-mono">
                  <FileClock className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">v{appInfo.version}</span>
                  {updateDownloading && (
                    <span
                      className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-sky-500"
                      title={`正在下载更新 ${updateState?.progress ?? 0}%`}
                    />
                  )}
                </span>
                {appInfo.channel !== 'stable' && (
                  <span
                    className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${
                      appInfo.channel === 'rc'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300'
                        : 'bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300'
                    }`}
                  >
                    {appInfo.channel}
                  </span>
                )}
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  );
};
