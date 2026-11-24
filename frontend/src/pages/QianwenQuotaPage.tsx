import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Link2, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ProviderLogo } from '../components/ProviderLogo';
import { QianwenAccountCard } from '../components/QianwenAccountCard';
import { useAccountStore } from '../store/useAccountStore';
import { useDeepSeekStore } from '../store/useDeepSeekStore';
import { useMotionStore } from '../store/useMotionStore';
import { useQianwenStore } from '../store/useQianwenStore';
import {
  isSettingsPath,
  openSettingsModal,
  resolveSafeQuotaFallback,
} from '../store/useSettingsModalStore';
import { QianwenAccountDisplay } from '../types';
import { adaptiveGridCols } from '../utils/layout';

export const QianwenQuotaPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    accounts,
    hasLoaded,
    loading,
    refreshingAll,
    refreshProgress,
    refreshAllAccounts,
  } = useQianwenStore();
  const agCount = useAccountStore((s) => s.accounts.length);
  const dsCount = useDeepSeekStore((s) => s.accounts.length);
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  // Auto-fallback when the last Qianwen account is removed, but never
  // while the settings modal is open on top of this background page
  useEffect(() => {
    if (isSettingsPath(location.pathname)) return;
    if (hasLoaded && !loading && accounts.length === 0) {
      navigate(resolveSafeQuotaFallback(agCount, 0, dsCount), { replace: true });
    }
  }, [hasLoaded, loading, accounts.length, agCount, dsCount, location.pathname, navigate]);

  const openNewConnect = () => {
    openSettingsModal(navigate, location, 'providers', {
      provider: 'qianwen',
      action: 'add',
    });
  };

  const openReauth = (account: QianwenAccountDisplay) => {
    openSettingsModal(navigate, location, 'providers', {
      provider: 'qianwen',
      action: 'reauth',
      qianwenAccountId: account.id,
    });
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-neutral-200/80 bg-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <ProviderLogo provider="qianwen" size="md" />
            <h2 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              千问 · Token Plan
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
            <p className="text-xs">正在加载千问账号数据...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-card/50 p-12 text-center dark:border-neutral-800 dark:bg-neutral-900/30">
            <ProviderLogo provider="qianwen" size="lg" />
            <h3 className="mt-4 text-base font-semibold text-neutral-800 dark:text-neutral-200">
              暂未连接任何千问账号
            </h3>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              前往「设置 → 供应商与账号」，使用官方 OAuth Device Flow 在浏览器一键授权登录，即可查看 Token Plan 套餐档位、到期时间与实时用量。
            </p>
            <button
              type="button"
              onClick={openNewConnect}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.98] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <Link2 className="h-4 w-4" />
              <span>前往设置连接千问账号</span>
            </button>
          </div>
        ) : (
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
                  <QianwenAccountCard account={account} onReauth={openReauth} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

    </>
  );
};
