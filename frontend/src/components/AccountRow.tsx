import React from 'react';
import { AccountDisplay } from '../types';
import { useAccountStore } from '../store/useAccountStore';
import {
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowRightLeft,
  AlertCircle,
  Clock,
  Sparkles,
} from 'lucide-react';
import { AccountQuotaDetail } from './AccountQuotaDetail';
import { ResetTimeText } from './ResetTimeText';
import { useResetTimeStore } from '../store/useResetTimeStore';
import { useNowTick } from '../hooks/useNowTick';
import { formatRelativeTime } from '../utils/quota';

interface AccountRowProps {
  account: AccountDisplay;
}

export const AccountRow: React.FC<AccountRowProps> = ({ account }) => {
  const {
    refreshingIds,
    switchingIds,
    refreshAccountQuota,
    switchAccount,
    confirmDeleteAccount,
    expandedIds,
    toggleExpand,
  } = useAccountStore();

  const isRefreshing = Boolean(refreshingIds[account.id]);
  const isSwitching = Boolean(switchingIds[account.id]);
  const isExpanded = Boolean(expandedIds[account.id]);
  const resetTimeFormat = useResetTimeStore((s) => s.resetTimeFormat);
  const nowMs = useNowTick();

  const pct = account.remainingPercentage;
  const isUnknown = pct < 0;
  const isLow = !isUnknown && pct <= 15;
  const isMid = !isUnknown && pct > 15 && pct <= 50;

  const tier = account.subscriptionTier || 'FREE';

  return (
    <div className="rounded-xl border border-neutral-200/90 bg-card transition-all shadow-xs hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700">
      <div className="flex flex-wrap items-center justify-between gap-4 p-4.5">
        {/* Account Info & Status */}
        <div className="flex min-w-[240px] flex-1 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 font-semibold text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
            {account.email.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold text-neutral-900 dark:text-neutral-100" title={account.email}>
                {account.email}
              </span>

              {account.isCurrent && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  当前账号
                </span>
              )}

              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
                  tier === 'PRO' || tier === 'ULTRA' || tier === 'ENTERPRISE'
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                    : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                }`}
              >
                {tier}
              </span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
              {account.name && account.name !== account.email && (
                <span>名称: {account.name}</span>
              )}
              <span className="flex items-center gap-1" title={account.lastRefreshedAt}>
                <Clock className="h-3 w-3" />
                上次刷新: {formatRelativeTime(account.lastRefreshedAt, nowMs)}
              </span>
              {account.lastSwitchedAt && (
                <span title={account.lastSwitchedAt}>
                  最近切换: {formatRelativeTime(account.lastSwitchedAt, nowMs)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Quota Summary & Reset Time */}
        <div className="flex min-w-[180px] flex-col justify-center sm:w-56">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-neutral-600 dark:text-neutral-400">
              剩余额度
            </span>
            <span
              className={`font-mono font-semibold ${
                isUnknown
                  ? 'text-neutral-400'
                  : isLow
                  ? 'text-rose-600 dark:text-rose-400'
                  : isMid
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-neutral-900 dark:text-neutral-100'
              }`}
            >
              {isUnknown ? '未知' : `${pct}%`}
            </span>
          </div>

          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            {!isUnknown && (
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  isLow
                    ? 'bg-rose-500'
                    : isMid
                    ? 'bg-amber-500'
                    : 'bg-emerald-500 dark:bg-emerald-400'
                }`}
                style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
              />
            )}
          </div>

          <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
            <span>重置时间:</span>
            <span className="font-medium text-neutral-700 dark:text-neutral-300">
              <ResetTimeText
                resetTime={account.resetTime}
                format={resetTimeFormat}
                nowMs={nowMs}
                absoluteStyle="bare"
              />
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => switchAccount(account.id)}
            disabled={account.isCurrent || isSwitching || isRefreshing}
            aria-label={`切换到账号 ${account.email}`}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors shadow-2xs active:scale-[0.98] disabled:cursor-not-allowed ${
              account.isCurrent
                ? 'bg-neutral-100 text-neutral-400 opacity-60 dark:bg-neutral-800 dark:text-neutral-500'
                : 'bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200'
            }`}
          >
            <ArrowRightLeft className={`h-3 w-3 ${isSwitching ? 'animate-spin' : ''}`} />
            <span>{isSwitching ? '切换中...' : account.isCurrent ? '当前使用' : '切换'}</span>
          </button>

          <button
            onClick={() => refreshAccountQuota(account.id)}
            disabled={isRefreshing || isSwitching}
            aria-label={`刷新账号 ${account.email} 额度`}
            title="刷新该账号额度"
            className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 text-xs font-medium text-neutral-700 shadow-2xs transition-colors hover:bg-neutral-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>

          <button
            onClick={() => confirmDeleteAccount(account)}
            disabled={isSwitching}
            aria-label={`删除账号 ${account.email}`}
            title="删除此账号记录"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-500 shadow-2xs transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98] dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:border-rose-900/40 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => toggleExpand(account.id)}
            aria-label="展开或收起额度明细"
            title={isExpanded ? '收起详情' : '展开窗口明细'}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-600 shadow-2xs transition-colors hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
          >
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Row-specific Error Alert */}
      {account.errorMessage && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="leading-snug">{account.errorMessage}</span>
        </div>
      )}

      {/* Collapsible Details */}
      {isExpanded && <AccountQuotaDetail account={account} />}
    </div>
  );
};
