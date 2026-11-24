import React, { useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { DeepSeekAccountCard } from '../components/DeepSeekAccountCard';
import { ProviderLogo } from '../components/ProviderLogo';
import { useAccountStore } from '../store/useAccountStore';
import { useDeepSeekStore } from '../store/useDeepSeekStore';
import { useMotionStore } from '../store/useMotionStore';
import { useQianwenStore } from '../store/useQianwenStore';
import {
  isSettingsPath,
  openSettingsModal,
  resolveSafeQuotaFallback,
} from '../store/useSettingsModalStore';
import { DeepSeekAccountDisplay } from '../types';
import { aggregateDeepSeekBalances, formatCurrencyAmount } from '../utils/deepseek';
import { adaptiveGridCols } from '../utils/layout';

export const DeepSeekQuotaPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    accounts,
    hasLoaded,
    loading,
    refreshingAll,
    refreshProgress,
    refreshAllAccounts,
  } = useDeepSeekStore();
  const agCount = useAccountStore((s) => s.accounts.length);
  const qwCount = useQianwenStore((s) => s.accounts.length);
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  const summary = useMemo(() => aggregateDeepSeekBalances(accounts), [accounts]);

  // Auto-fallback when the last DeepSeek account is removed, but never
  // while the settings modal is open on top of this background page
  useEffect(() => {
    if (isSettingsPath(location.pathname)) return;
    if (hasLoaded && !loading && accounts.length === 0) {
      navigate(resolveSafeQuotaFallback(agCount, qwCount, 0), { replace: true });
    }
  }, [hasLoaded, loading, accounts.length, agCount, qwCount, location.pathname, navigate]);

  const openNewAdd = () => {
    openSettingsModal(navigate, location, 'providers', {
      provider: 'deepseek',
      action: 'add',
    });
  };

  const openEditAccount = (account: DeepSeekAccountDisplay) => {
    openSettingsModal(navigate, location, 'providers', {
      provider: 'deepseek',
      action: 'edit',
      deepseekAccountId: account.id,
    });
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <ProviderLogo provider="deepseek" size="md" />
            <h2 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              DeepSeek · 余额
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={refreshAllAccounts}
              disabled={refreshingAll || accounts.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-card px-3.5 py-2 text-xs font-medium text-neutral-700 shadow-xs transition-colors hover:bg-neutral-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshingAll ? 'animate-spin' : ''}`} />
              <span>
                {refreshingAll
                  ? refreshProgress
                    ? `刷新中 (${refreshProgress.completed}/${refreshProgress.total})`
                    : '正在刷新...'
                  : '刷新全部'}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        {loading && accounts.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-neutral-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-800 dark:border-neutral-700 dark:border-t-neutral-200" />
            <p className="text-xs">正在加载 DeepSeek 账号数据...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-card/50 p-12 text-center dark:border-neutral-800 dark:bg-neutral-900/30">
            <ProviderLogo provider="deepseek" size="lg" />
            <h3 className="mt-4 text-base font-semibold text-neutral-800 dark:text-neutral-200">
              暂未连接任何 DeepSeek 账号
            </h3>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              前往「设置 → 供应商与账号」添加 DeepSeek API Key，凭据将仅保存在 Windows 凭据管理器中，即可实时查询各币种余额、充值与赠金明细。
            </p>
            <button
              type="button"
              onClick={openNewAdd}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.98] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <KeyRound className="h-4 w-4" />
              <span>前往设置添加 API Key</span>
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Multi-Account Currency Summary Bar */}
            {accounts.length >= 2 && summary.currencies.length > 0 && (
              <div className="rounded-2xl border border-neutral-200/85 bg-card p-4 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/80">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                    全部 {accounts.length} 个账号余额汇总
                  </span>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-neutral-500 dark:text-neutral-400">
                      可用 {summary.availableCount} / {accounts.length}
                    </span>
                    {summary.invalidKeyCount > 0 && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
                        {summary.invalidKeyCount} 个 Key 失效
                      </span>
                    )}
                  </div>
                </div>

                <div
                  className={`mt-3 grid gap-3 ${adaptiveGridCols(
                    summary.currencies.length,
                    'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
                    'grid-cols-1 sm:grid-cols-2'
                  )}`}
                >
                  {summary.currencies.map((cur) => (
                    <div
                      key={cur.currency}
                      className="flex items-baseline justify-between gap-3 rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3.5 py-2.5 dark:border-neutral-800/80 dark:bg-neutral-950/50"
                    >
                      <div>
                        <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                          {cur.currency} 合计
                        </div>
                        <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
                          {formatCurrencyAmount(cur.currency, cur.totalBalance)}
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-neutral-500 dark:text-neutral-400">
                        <div>
                          充值{' '}
                          <span className="font-mono font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
                            {formatCurrencyAmount(cur.currency, cur.toppedUpBalance)}
                          </span>
                        </div>
                        <div>
                          赠金{' '}
                          <span className="font-mono font-medium tabular-nums text-neutral-700 dark:text-neutral-300">
                            {formatCurrencyAmount(cur.currency, cur.grantedBalance)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div
              className={`grid gap-4 ${adaptiveGridCols(
                accounts.length,
                'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
                'grid-cols-1 md:grid-cols-2'
              )}`}
            >
              <AnimatePresence initial={false}>
                {accounts.map((account) => (
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
                    <DeepSeekAccountCard account={account} onEdit={openEditAccount} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>
    </>
  );
};
