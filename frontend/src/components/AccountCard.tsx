import React from 'react';
import { AccountDisplay } from '../types';
import { useAccountStore } from '../store/useAccountStore';
import { useResetTimeStore } from '../store/useResetTimeStore';
import { useNowTick } from '../hooks/useNowTick';
import {
  formatBucketLabel,
  formatRelativeTime,
  getQuotaTextColor,
  isPaidTier,
} from '../utils/quota';
import { QuotaProgressBar } from './QuotaProgressBar';
import { ResetTimeText } from './ResetTimeText';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
} from 'lucide-react';

interface AccountCardProps {
  account: AccountDisplay;
  onOpenDetail: (accountId: string) => void;
}

export const AccountCard: React.FC<AccountCardProps> = ({ account, onOpenDetail }) => {
  const { refreshingIds, switchingIds, refreshAccountQuota, switchAccount } = useAccountStore();
  const resetTimeFormat = useResetTimeStore((s) => s.resetTimeFormat);
  const nowMs = useNowTick();

  const isRefreshing = Boolean(refreshingIds[account.id]);
  const isSwitching = Boolean(switchingIds[account.id]);
  const tier = account.subscriptionTier || 'FREE';
  const groups = account.groups || [];
  const pct = account.remainingPercentage;
  const isUnknown = pct < 0;

  return (
    <div
      className={`group/card flex w-full flex-col rounded-2xl border bg-card transition-all duration-150 dark:bg-neutral-900 ${
        account.isCurrent
          ? 'border-emerald-500/80 ring-1 ring-emerald-500/30 shadow-sm dark:border-emerald-500/60 dark:ring-emerald-500/20'
          : 'border-neutral-200/90 shadow-xs hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'
      }`}
    >
      {/* Card Header: Identity & Primary Actions */}
      <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3.5 dark:border-neutral-800/80">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
              account.isCurrent
                ? 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
            }`}
          >
            {account.email.charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100"
                title={account.email}
              >
                {account.email}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${
                  isPaidTier(tier)
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                    : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                }`}
              >
                {tier}
              </span>
            </div>

            <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
              {account.name && account.name !== account.email && (
                <span className="truncate max-w-[110px]" title={account.name}>
                  {account.name}
                </span>
              )}
              {account.name && account.name !== account.email && (
                <span className="text-neutral-300 dark:text-neutral-700">·</span>
              )}
              <span className="flex shrink-0 items-center gap-1" title={account.lastRefreshedAt}>
                <Clock className="h-2.5 w-2.5" />
                {formatRelativeTime(account.lastRefreshedAt, nowMs)}
              </span>
            </div>
          </div>
        </div>

        {/* Top-Right Switch & Refresh */}
        <div className="flex shrink-0 items-center gap-1.5">
          {account.isCurrent ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-500/30">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              使用中
            </span>
          ) : (
            <button
              onClick={() => switchAccount(account.id)}
              disabled={isSwitching || isRefreshing}
              aria-label={`切换到账号 ${account.email}`}
              className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-2xs transition-colors hover:bg-neutral-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {isSwitching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-3 w-3" />
              )}
              <span>{isSwitching ? '切换中' : '切换'}</span>
            </button>
          )}

          <button
            onClick={() => refreshAccountQuota(account.id)}
            disabled={isRefreshing || isSwitching}
            aria-label={`刷新账号 ${account.email} 额度`}
            title="刷新该账号额度"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-600 shadow-2xs transition-colors hover:bg-neutral-50 hover:text-neutral-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Quota Area (Click to open Model Details & Delete Modal) */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenDetail(account.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenDetail(account.id);
          }
        }}
        title="点击查看单模型额度明细与账号管理"
        className="flex flex-1 cursor-pointer flex-col justify-between gap-3 rounded-b-2xl p-4 text-left transition-colors hover:bg-neutral-50/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:hover:bg-neutral-800/35"
      >
        {groups.length > 0 ? (
          <div className="space-y-3">
            {groups.map((group, gIdx) => (
              <div
                key={gIdx}
                className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 p-3 dark:border-neutral-800/80 dark:bg-neutral-950/50"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                    {group.displayName || '通用分组'}
                  </span>
                </div>

                {group.buckets && group.buckets.length > 0 ? (
                  <div className="space-y-2.5">
                    {group.buckets.map((b, bIdx) => {
                      const bucketPct = Math.round(b.remainingFraction * 100);
                      return (
                        <div key={bIdx} className="space-y-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                              {formatBucketLabel(b.displayName || b.window || b.bucketId)}
                            </span>
                            <div className="flex items-baseline gap-2">
                              {b.resetTime && (
                                <ResetTimeText
                                  resetTime={b.resetTime}
                                  format={resetTimeFormat}
                                  nowMs={nowMs}
                                  absoluteStyle="suffix"
                                  className="text-[10px] text-neutral-400 dark:text-neutral-500"
                                />
                              )}
                              <span
                                className={`font-mono text-sm font-bold tabular-nums ${getQuotaTextColor(
                                  bucketPct
                                )}`}
                              >
                                {bucketPct}%
                              </span>
                            </div>
                          </div>

                          <QuotaProgressBar
                            percentage={bucketPct}
                            size="md"
                            className="mt-0.5"
                            ariaLabel={`${formatBucketLabel(b.displayName || b.window || b.bucketId)} 剩余额度`}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    暂无生效中的计费窗口
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 p-3.5 dark:border-neutral-800/80 dark:bg-neutral-950/50">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                综合剩余额度
              </span>
              <span
                className={`font-mono text-base font-bold tabular-nums ${getQuotaTextColor(pct)}`}
              >
                {isUnknown ? '未知' : `${pct}%`}
              </span>
            </div>
            <QuotaProgressBar
              percentage={pct}
              size="md"
              className="mt-2"
              ariaLabel="综合剩余额度"
            />
            <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
              <span>重置时间</span>
              <ResetTimeText
                resetTime={account.resetTime}
                format={resetTimeFormat}
                nowMs={nowMs}
                absoluteStyle="bare"
              />
            </div>
          </div>
        )}

        {/* Card-specific Error Alert */}
        {account.errorMessage && (
          <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-2 leading-snug">{account.errorMessage}</span>
          </div>
        )}

        {/* Subtle Detail Hint Footer */}
        <div className="flex items-center justify-between pt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
          <span>
            {account.models && account.models.length > 0
              ? `${account.models.length} 个模型明细`
              : '账号详情与管理'}
          </span>
          <span className="inline-flex items-center gap-0.5 font-medium text-neutral-500 transition-transform group-hover/card:translate-x-0.5 group-hover/card:text-neutral-800 dark:text-neutral-400 dark:group-hover/card:text-neutral-200">
            <span>查看明细</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </div>
  );
};
