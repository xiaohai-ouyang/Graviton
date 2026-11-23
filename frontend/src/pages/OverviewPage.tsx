import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  KeyRound,
  LayoutGrid,
  Link2,
  PictureInPicture2,
  RefreshCw,
  Table2,
  UserPlus,
} from 'lucide-react';
import { motion } from 'motion/react';
import { ProviderLogo } from '../components/ProviderLogo';
import {
  AntigravityProviderCard,
  DeepSeekProviderCard,
  QianwenProviderCard,
} from '../components/overview/ProviderBentoCards';
import { OverviewTableView } from '../components/overview/OverviewTableView';
import { useNowTick } from '../hooks/useNowTick';
import { useAccountStore } from '../store/useAccountStore';
import { useDeepSeekStore } from '../store/useDeepSeekStore';
import { useMotionStore } from '../store/useMotionStore';
import {
  OverviewViewMode,
  useOverviewPrefsStore,
} from '../store/useOverviewPrefsStore';
import { useQianwenStore } from '../store/useQianwenStore';
import { openSettingsModal } from '../store/useSettingsModalStore';
import { QuotaDisplayMode } from '../utils/quota';

const VIEW_MODES: { id: OverviewViewMode; label: string; icon: React.ReactNode }[] = [
  { id: 'card', label: '卡片', icon: <LayoutGrid className="h-3 w-3" /> },
  { id: 'table', label: '表格', icon: <Table2 className="h-3 w-3" /> },
];

const QUOTA_MODES: { id: QuotaDisplayMode; label: string }[] = [
  { id: 'used', label: '已用' },
  { id: 'remaining', label: '剩余' },
];

export const OverviewPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);
  const nowMs = useNowTick();

  const {
    accounts: agAccounts,
    hasLoaded: agHasLoaded,
    refreshingAll: agRefreshingAll,
    refreshAllQuotas: refreshAllAg,
    widgetOpen,
    toggleWidget,
  } = useAccountStore();

  const {
    accounts: qwAccounts,
    hasLoaded: qwHasLoaded,
    refreshingAll: qwRefreshingAll,
    refreshAllAccounts: refreshAllQw,
  } = useQianwenStore();

  const {
    accounts: dsAccounts,
    hasLoaded: dsHasLoaded,
    refreshingAll: dsRefreshingAll,
    refreshAllAccounts: refreshAllDs,
  } = useDeepSeekStore();

  const {
    viewMode,
    quotaDisplayMode,
    maskAccount,
    setViewMode,
    setQuotaDisplayMode,
    toggleMaskAccount,
  } = useOverviewPrefsStore();

  const anyRefreshingAll = agRefreshingAll || qwRefreshingAll || dsRefreshingAll;
  const totalCount = agAccounts.length + qwAccounts.length + dsAccounts.length;
  const isLoading = (!agHasLoaded || !qwHasLoaded || !dsHasLoaded) && totalCount === 0;

  const connectedProviders: ('antigravity' | 'qianwen' | 'deepseek')[] = [];
  if (agAccounts.length > 0) connectedProviders.push('antigravity');
  if (qwAccounts.length > 0) connectedProviders.push('qianwen');
  if (dsAccounts.length > 0) connectedProviders.push('deepseek');

  const subtitleParts: string[] = [];
  if (agAccounts.length > 0) subtitleParts.push(`Antigravity ${agAccounts.length}`);
  if (qwAccounts.length > 0) subtitleParts.push(`千问 ${qwAccounts.length}`);
  if (dsAccounts.length > 0) subtitleParts.push(`DeepSeek ${dsAccounts.length}`);
  const headerSubtitle =
    subtitleParts.length > 0
      ? `已连接 ${subtitleParts.join(' · ')}`
      : '尚未连接任何供应商账号';

  const handleRefreshAllProviders = async () => {
    const tasks: Promise<unknown>[] = [];
    if (agAccounts.length > 0 && !agRefreshingAll) {
      tasks.push(refreshAllAg());
    }
    if (qwAccounts.length > 0 && !qwRefreshingAll) {
      tasks.push(refreshAllQw());
    }
    if (dsAccounts.length > 0 && !dsRefreshingAll) {
      tasks.push(refreshAllDs());
    }
    await Promise.all(tasks);
  };

  // Adaptive masonry container: avoid leaving blank columns when 1 or 2 providers are connected
  const masonryContainerClass =
    connectedProviders.length === 1
      ? 'space-y-4'
      : connectedProviders.length === 2
        ? 'columns-1 gap-4 space-y-4 lg:columns-2'
        : 'columns-1 gap-4 space-y-4 md:columns-2 xl:columns-3';

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-baseline gap-2.5">
            <h2 className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              概览
            </h2>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              {headerSubtitle}
            </span>
          </div>

          {/* High-Density Console Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleRefreshAllProviders()}
              disabled={anyRefreshingAll || totalCount === 0}
              title="刷新全部已连接供应商额度"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-neutral-200/90 bg-card px-2.5 text-[11px] font-medium text-neutral-700 shadow-2xs transition-colors hover:bg-neutral-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <RefreshCw className={`h-3 w-3 ${anyRefreshingAll ? 'animate-spin' : ''}`} />
              <span>{anyRefreshingAll ? '刷新中' : '刷新'}</span>
            </button>

            <button
              type="button"
              onClick={() => void toggleWidget()}
              title={widgetOpen ? '关闭桌面悬浮窗' : '开启桌面悬浮窗'}
              className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium shadow-2xs transition-colors active:scale-[0.98] ${
                widgetOpen
                  ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700 hover:bg-emerald-100/80 dark:border-emerald-500/40 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60'
                  : 'border-neutral-200/90 bg-card text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-200 dark:hover:bg-neutral-700'
              }`}
            >
              <PictureInPicture2 className="h-3 w-3" />
              <span>{widgetOpen ? '悬浮窗已开' : '悬浮窗'}</span>
            </button>

            <button
              type="button"
              onClick={toggleMaskAccount}
              aria-pressed={maskAccount}
              title={maskAccount ? '关闭账号打码' : '开启账号打码（截图脱敏）'}
              className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium shadow-2xs transition-colors active:scale-[0.98] ${
                maskAccount
                  ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                  : 'border-neutral-200/90 bg-card text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-200 dark:hover:bg-neutral-700'
              }`}
            >
              {maskAccount ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              <span>账号打码</span>
            </button>

            {/* Card / Table Switcher */}
            <div
              role="group"
              aria-label="切换卡片或表格视图"
              className="inline-flex h-7 items-center rounded-lg border border-neutral-200/90 bg-neutral-100/80 p-0.5 dark:border-neutral-800 dark:bg-neutral-950/70"
            >
              {VIEW_MODES.map((opt) => {
                const active = viewMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setViewMode(opt.id)}
                    className={`relative inline-flex h-full items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
                      active
                        ? 'text-neutral-900 dark:text-neutral-100'
                        : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId={shouldAnimate ? 'overview-view-pill' : undefined}
                        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-0 rounded-md bg-card shadow-2xs dark:bg-neutral-800"
                      />
                    )}
                    <span className="relative z-10 inline-flex items-center gap-1">
                      {opt.icon}
                      <span>{opt.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Used / Remaining Switcher */}
            <div
              role="group"
              aria-label="切换已用或剩余显示模式"
              className="inline-flex h-7 items-center rounded-lg border border-neutral-200/90 bg-neutral-100/80 p-0.5 dark:border-neutral-800 dark:bg-neutral-950/70"
            >
              {QUOTA_MODES.map((opt) => {
                const active = quotaDisplayMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setQuotaDisplayMode(opt.id)}
                    className={`relative inline-flex h-full items-center rounded-md px-2 text-[11px] font-medium transition-colors ${
                      active
                        ? 'text-neutral-900 dark:text-neutral-100'
                        : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId={shouldAnimate ? 'overview-mode-pill' : undefined}
                        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                        className="absolute inset-0 rounded-md bg-card shadow-2xs dark:bg-neutral-800"
                      />
                    )}
                    <span className="relative z-10">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1440px] flex-1 px-5 py-5">
        {isLoading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-neutral-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-800 dark:border-neutral-700 dark:border-t-neutral-200" />
            <p className="text-xs">正在加载各供应商额度概览...</p>
          </div>
        ) : totalCount === 0 ? (
          <div className="mx-auto max-w-3xl rounded-2xl border border-dashed border-neutral-300 bg-card/60 p-8 text-center dark:border-neutral-800 dark:bg-neutral-900/40">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
              <LayoutGrid className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-neutral-900 dark:text-neutral-100">
              尚未连接任何 AI 供应商账号
            </h3>
            <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              前往「设置 → 供应商与账号」接入任意供应商后，左侧「额度」菜单与此处 Bento 面板将自动按供应商聚合展示实时额度与余额。
            </p>

            <div className="mt-6 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
              <button
                type="button"
                onClick={() =>
                  openSettingsModal(navigate, location, 'providers', {
                    provider: 'antigravity',
                    action: 'add',
                  })
                }
                className="group flex flex-col justify-between gap-3 rounded-xl border border-neutral-200/90 bg-card p-4 shadow-2xs transition-all hover:border-neutral-300 hover:shadow-xs dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
              >
                <div className="flex items-center gap-2.5">
                  <ProviderLogo provider="antigravity" size="md" />
                  <div>
                    <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      连接 Antigravity
                    </div>
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      OAuth / 导入 Token / 收录本机账号
                    </div>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-700 group-hover:text-neutral-950 dark:text-neutral-300 dark:group-hover:text-white">
                  <UserPlus className="h-3.5 w-3.5" />
                  前往设置添加
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  openSettingsModal(navigate, location, 'providers', {
                    provider: 'qianwen',
                    action: 'add',
                  })
                }
                className="group flex flex-col justify-between gap-3 rounded-xl border border-neutral-200/90 bg-card p-4 shadow-2xs transition-all hover:border-indigo-300 hover:shadow-xs dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-indigo-800"
              >
                <div className="flex items-center gap-2.5">
                  <ProviderLogo provider="qianwen" size="md" />
                  <div>
                    <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      连接千问 · Token Plan
                    </div>
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      官方 OAuth Device Flow 一键授权
                    </div>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 group-hover:text-indigo-700 dark:text-indigo-400 dark:group-hover:text-indigo-300">
                  <Link2 className="h-3.5 w-3.5" />
                  前往设置连接
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  openSettingsModal(navigate, location, 'providers', {
                    provider: 'deepseek',
                    action: 'add',
                  })
                }
                className="group flex flex-col justify-between gap-3 rounded-xl border border-neutral-200/90 bg-card p-4 shadow-2xs transition-all hover:border-blue-300 hover:shadow-xs dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-blue-800"
              >
                <div className="flex items-center gap-2.5">
                  <ProviderLogo provider="deepseek" size="md" />
                  <div>
                    <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                      连接 DeepSeek
                    </div>
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      API Key 查询实时余额与赠金明细
                    </div>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 group-hover:text-blue-700 dark:text-blue-400 dark:group-hover:text-blue-300">
                  <KeyRound className="h-3.5 w-3.5" />
                  前往设置添加
                </span>
              </button>
            </div>
          </div>
        ) : viewMode === 'table' ? (
          <OverviewTableView nowMs={nowMs} />
        ) : (
          <div className={masonryContainerClass}>
            {agAccounts.length > 0 && (
              <AntigravityProviderCard
                nowMs={nowMs}
                singleProviderLayout={connectedProviders.length === 1}
              />
            )}
            {qwAccounts.length > 0 && (
              <QianwenProviderCard
                nowMs={nowMs}
                singleProviderLayout={connectedProviders.length === 1}
              />
            )}
            {dsAccounts.length > 0 && (
              <DeepSeekProviderCard
                nowMs={nowMs}
                singleProviderLayout={connectedProviders.length === 1}
              />
            )}
          </div>
        )}
      </main>
    </>
  );
};
