import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDownWideNarrow,
  PictureInPicture2,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAccountStore } from '../store/useAccountStore';
import { useDeepSeekStore } from '../store/useDeepSeekStore';
import { useMotionStore } from '../store/useMotionStore';
import { useQianwenStore } from '../store/useQianwenStore';
import {
  isSettingsPath,
  openSettingsModal,
  resolveSafeQuotaFallback,
} from '../store/useSettingsModalStore';
import { adaptiveGridCols } from '../utils/layout';
import { sortAntigravityAccounts } from '../utils/quota';
import { AccountCard } from '../components/AccountCard';
import { AccountDetailModal } from '../components/AccountDetailModal';
import { ProviderLogo } from '../components/ProviderLogo';

type SortMode = 'default' | 'gemini' | 'claude';

export const QuotaPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    accounts,
    hasLoaded,
    loading,
    capturing,
    refreshingAll,
    refreshProgress,
    refreshAllQuotas,
    widgetOpen,
    toggleWidget,
  } = useAccountStore();
  const qwCount = useQianwenStore((s) => s.accounts.length);
  const dsCount = useDeepSeekStore((s) => s.accounts.length);

  const [sortMode, setSortMode] = useState<SortMode>('default');
  const [detailAccountId, setDetailAccountId] = useState<string | null>(null);
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  // Auto-fallback when the last Antigravity account is removed, but never
  // while the settings modal is open on top of this background page
  useEffect(() => {
    if (isSettingsPath(location.pathname)) return;
    if (hasLoaded && !loading && accounts.length === 0) {
      navigate(resolveSafeQuotaFallback(0, qwCount, dsCount), { replace: true });
    }
  }, [hasLoaded, loading, accounts.length, qwCount, dsCount, location.pathname, navigate]);

  const currentAccount = useMemo(
    () => accounts.find((a) => a.isCurrent) ?? null,
    [accounts]
  );

  const sortedAccounts = useMemo(() => {
    if (sortMode === 'default') return accounts;
    return sortAntigravityAccounts(accounts, sortMode, { pinCurrent: false });
  }, [accounts, sortMode]);

  const detailAccount = useMemo(
    () => accounts.find((a) => a.id === detailAccountId) ?? null,
    [accounts, detailAccountId]
  );

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <ProviderLogo provider="antigravity" size="md" />
            <div>
              <h2 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                Antigravity · 额度
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {currentAccount ? (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    当前客户端账号：
                    <strong className="font-medium text-neutral-800 dark:text-neutral-200">
                      {currentAccount.email}
                    </strong>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                    当前客户端账号：未知
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={refreshAllQuotas}
              disabled={capturing || refreshingAll || accounts.length === 0}
              aria-label="刷新全部额度"
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-card px-3.5 py-2 text-xs font-medium text-neutral-700 shadow-xs transition-colors hover:bg-neutral-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshingAll ? 'animate-spin' : ''}`} />
              <span>
                {refreshingAll
                  ? refreshProgress
                    ? `刷新中 (${refreshProgress.completed}/${refreshProgress.total})`
                    : '正在刷新全部...'
                  : '刷新全部'}
              </span>
            </button>

            <button
              onClick={toggleWidget}
              aria-label="切换桌面悬浮窗"
              title={widgetOpen ? '关闭桌面悬浮窗' : '开启桌面悬浮窗'}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium shadow-xs transition-colors active:scale-[0.98] ${
                widgetOpen
                  ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700 hover:bg-emerald-100/80 dark:border-emerald-500/40 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60'
                  : 'border-neutral-200 bg-card text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
              }`}
            >
              <PictureInPicture2 className="h-3.5 w-3.5" />
              <span>{widgetOpen ? '悬浮窗已开' : '悬浮窗'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        {loading && accounts.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-neutral-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-800 dark:border-neutral-700 dark:border-t-neutral-200" />
            <p className="text-xs">正在加载账号数据与凭据...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-card/50 p-12 text-center dark:border-neutral-800 dark:bg-neutral-900/30">
            <ProviderLogo provider="antigravity" size="lg" />
            <h3 className="mt-4 text-base font-semibold text-neutral-800 dark:text-neutral-200">
              暂未收录任何 Antigravity 账号
            </h3>
            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              前往「设置 → 供应商与账号」，通过 OAuth 登录、导入 Token 或收录本机当前登录的 Antigravity 账号，查看各模型组配额并在多账号间快速切换。
            </p>
            <button
              onClick={() =>
                openSettingsModal(navigate, location, 'providers', {
                  provider: 'antigravity',
                  action: 'add',
                })
              }
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.98] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <UserPlus className="h-4 w-4" />
              <span>前往设置添加 Antigravity 账号</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Compact Status & Sort Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-0.5">
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                  全部账号 ({accounts.length})
                </span>
                <span className="text-neutral-300 dark:text-neutral-700">|</span>
                {currentAccount ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    当前使用: <strong className="font-semibold">{currentAccount.email}</strong>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/50 dark:text-amber-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    当前客户端账号未收录或未知
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <span className="hidden items-center gap-1 text-[11px] text-neutral-500 sm:inline-flex dark:text-neutral-400">
                  <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                  排序:
                </span>
                <div className="inline-flex rounded-lg border border-neutral-200/90 bg-card p-0.5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900">
                  {(
                    [
                      { id: 'default', label: '默认顺序' },
                      { id: 'gemini', label: 'Gemini 额度' },
                      { id: 'claude', label: 'Claude 额度' },
                    ] as const
                  ).map((opt) => {
                    const isActive = sortMode === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => setSortMode(opt.id)}
                        className={`relative rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          isActive
                            ? 'text-white dark:text-neutral-900'
                            : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
                        }`}
                      >
                        {isActive && (
                          <motion.span
                            layoutId={shouldAnimate ? 'quota-sort-pill' : undefined}
                            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                            className="inset-0 absolute rounded-md bg-neutral-900 shadow-2xs dark:bg-neutral-100"
                          />
                        )}
                        <span className="relative z-10">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Multi-Account Quota Grid */}
            <div
              className={`grid gap-4 ${adaptiveGridCols(
                sortedAccounts.length,
                'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
                'grid-cols-1 md:grid-cols-2'
              )}`}
            >
              <AnimatePresence initial={false}>
                {sortedAccounts.map((account) => (
                  <motion.div
                    key={account.id}
                    layout={shouldAnimate ? 'position' : false}
                    initial={shouldAnimate ? { opacity: 0, y: 6 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    exit={shouldAnimate ? { opacity: 0, scale: 0.96 } : { opacity: 0 }}
                    transition={
                      shouldAnimate
                        ? { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
                        : { duration: 0 }
                    }
                    className="flex"
                  >
                    <AccountCard
                      account={account}
                      onOpenDetail={(id) => setDetailAccountId(id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      <AccountDetailModal
        account={detailAccount}
        onClose={() => setDetailAccountId(null)}
      />
    </>
  );
};
