import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AccountDisplay } from '../types';
import { useAccountStore } from '../store/useAccountStore';
import { useResetTimeStore } from '../store/useResetTimeStore';
import { useNowTick } from '../hooks/useNowTick';
import {
  formatBucketLabel,
  formatRelativeTime,
  getQuotaTextColor,
} from '../utils/quota';
import { QuotaProgressBar } from './QuotaProgressBar';
import { ResetTimeText } from './ResetTimeText';
import {
  ArrowRightLeft,
  Clock,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
  AlertCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useMotionStore } from '../store/useMotionStore';

interface AccountDetailModalProps {
  account: AccountDisplay | null;
  onClose: () => void;
}

export const AccountDetailModal: React.FC<AccountDetailModalProps> = ({ account, onClose }) => {
  const {
    refreshingIds,
    switchingIds,
    refreshAccountQuota,
    switchAccount,
    confirmDeleteAccount,
  } = useAccountStore();
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);
  const resetTimeFormat = useResetTimeStore((s) => s.resetTimeFormat);
  const nowMs = useNowTick();

  const open = Boolean(account);
  if (!account) return null;

  const isRefreshing = Boolean(refreshingIds[account.id]);
  const isSwitching = Boolean(switchingIds[account.id]);
  const groups = account.groups || [];
  const models = [...(account.models || [])].sort((a, b) => b.percentage - a.percentage);
  const tier = account.subscriptionTier || 'FREE';

  const handleDelete = () => {
    onClose();
    confirmDeleteAccount(account);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={shouldAnimate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={shouldAnimate ? { duration: 0.14 } : { duration: 0 }}
            className="fixed inset-0 z-40 bg-black/45 backdrop-blur-xs"
          />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <motion.div
            initial={shouldAnimate ? { opacity: 0, scale: 0.96, y: 4 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={
              shouldAnimate
                ? { duration: 0.15, ease: [0.22, 1, 0.36, 1] }
                : { duration: 0 }
            }
            className="fixed left-1/2 top-1/2 z-40 flex max-h-[85vh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-neutral-200 bg-card shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
          >
          {/* Modal Header */}
          <div className="flex items-start justify-between gap-4 border-b border-neutral-200/80 px-6 py-4 dark:border-neutral-800">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-semibold ${
                  account.isCurrent
                    ? 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300'
                    : 'bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200'
                }`}
              >
                {account.email.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Dialog.Title className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    {account.email}
                  </Dialog.Title>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                      tier === 'PRO' || tier === 'ULTRA' || tier === 'ENTERPRISE'
                        ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                        : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                    }`}
                  >
                    {tier}
                  </span>
                  {account.isCurrent && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      当前使用中
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                  {account.name && account.name !== account.email && <span>{account.name}</span>}
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    上次刷新: {formatRelativeTime(account.lastRefreshedAt, nowMs)}
                  </span>
                  {account.lastSwitchedAt && (
                    <span>最近切换: {formatRelativeTime(account.lastSwitchedAt, nowMs)}</span>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              aria-label="关闭弹窗"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable Body */}
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 text-xs">
            {account.errorMessage && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3.5 py-2.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{account.errorMessage}</span>
              </div>
            )}

            {/* Quota Groups */}
            <div>
              <div className="mb-3 flex items-center gap-1.5 font-semibold text-neutral-700 dark:text-neutral-300">
                <Layers className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
                <span>模型分组额度窗口</span>
              </div>

              {groups.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {groups.map((group, gIdx) => (
                    <div
                      key={gIdx}
                      className="rounded-xl border border-neutral-200/90 bg-neutral-50/70 p-3.5 dark:border-neutral-800 dark:bg-neutral-950/50"
                    >
                      <div className="mb-2.5 flex items-center justify-between border-b border-neutral-200/70 pb-2 dark:border-neutral-800">
                        <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                          {group.displayName || '通用分组'}
                        </span>
                      </div>

                      <div className="space-y-3">
                        {group.buckets && group.buckets.length > 0 ? (
                          group.buckets.map((b, bIdx) => {
                            const pct = Math.round(b.remainingFraction * 100);
                            return (
                              <div key={bIdx} className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
                                    {formatBucketLabel(b.displayName || b.window || b.bucketId)}
                                  </span>
                                  <span className={`font-mono text-sm font-bold ${getQuotaTextColor(pct)}`}>
                                    {pct}%
                                  </span>
                                </div>

                                <QuotaProgressBar
                                  percentage={pct}
                                  size="md"
                                  className="pt-0.5"
                                  ariaLabel={`${formatBucketLabel(b.displayName || b.window || b.bucketId)} 剩余额度`}
                                />

                                {b.resetTime && (
                                  <div className="flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                                    <Clock className="h-2.5 w-2.5 shrink-0" />
                                    <ResetTimeText
                                      resetTime={b.resetTime}
                                      format={resetTimeFormat}
                                      nowMs={nowMs}
                                      absoluteStyle="prefix"
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                            该组暂无生效中的计费窗口
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-neutral-200 p-4 text-center text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  暂无独立分组窗口数据，请尝试点击下方「刷新额度」。
                </p>
              )}
            </div>

            {/* Individual Models */}
            {models.length > 0 && (
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-semibold text-neutral-700 dark:text-neutral-300">
                    <Sparkles className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
                    <span>可用模型与额度明细 ({models.length})</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {models.map((m, mIdx) => (
                    <div
                      key={mIdx}
                      className={`flex items-center justify-between gap-2 rounded-lg border border-neutral-200/80 bg-neutral-50/50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950/40 ${
                        m.percentage === 0 ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-neutral-800 dark:text-neutral-200" title={m.displayName || m.name}>
                          {m.displayName || m.name}
                        </div>
                        {m.resetTime && (
                          <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
                            <ResetTimeText
                              resetTime={m.resetTime}
                              format={resetTimeFormat}
                              nowMs={nowMs}
                              absoluteStyle="prefix"
                            />
                          </div>
                        )}
                      </div>
                      <span className={`shrink-0 font-mono text-xs font-bold ${getQuotaTextColor(m.percentage)}`}>
                        {m.percentage >= 0 ? `${m.percentage}%` : '未知'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200/80 bg-neutral-50/60 px-6 py-3.5 rounded-b-2xl dark:border-neutral-800 dark:bg-neutral-950/50">
            <button
              onClick={handleDelete}
              disabled={isSwitching}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-100 active:scale-[0.98] disabled:opacity-50 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>删除账号</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => refreshAccountQuota(account.id)}
                disabled={isRefreshing || isSwitching}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-card px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-2xs transition-colors hover:bg-neutral-50 active:scale-[0.98] disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>{isRefreshing ? '刷新中...' : '刷新额度'}</span>
              </button>

              {!account.isCurrent && (
                <button
                  onClick={() => switchAccount(account.id)}
                  disabled={isSwitching || isRefreshing}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white shadow-2xs transition-colors hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  {isSwitching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  )}
                  <span>{isSwitching ? '切换中...' : '切换到此账号'}</span>
                </button>
              )}

              <button
                onClick={onClose}
                className="rounded-lg border border-neutral-200 bg-card px-3 py-1.5 text-xs font-medium text-neutral-600 shadow-2xs hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              >
                关闭
              </button>
            </div>
          </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
