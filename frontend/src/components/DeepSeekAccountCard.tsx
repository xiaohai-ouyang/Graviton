import React from 'react';
import {
  AlertCircle,
  Clock,
  KeyRound,
  Pencil,
  RefreshCw,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useNowTick } from '../hooks/useNowTick';
import { useDeepSeekStore } from '../store/useDeepSeekStore';
import { DeepSeekAccountDisplay } from '../types';
import {
  formatCurrencyAmount,
  getBalanceInfoTone,
  getDeepSeekAmountColorClass,
  getDeepSeekBadgeClass,
  getDeepSeekStatusBadge,
} from '../utils/deepseek';
import { adaptiveGridCols } from '../utils/layout';
import { formatRelativeTime } from '../utils/quota';
import { ProviderLogo } from './ProviderLogo';

interface DeepSeekAccountCardProps {
  account: DeepSeekAccountDisplay;
  onEdit: (account: DeepSeekAccountDisplay) => void;
}

export const DeepSeekAccountCard: React.FC<DeepSeekAccountCardProps> = ({
  account,
  onEdit,
}) => {
  const { refreshingIds, refreshAccount, confirmDeleteAccount } = useDeepSeekStore();
  const nowMs = useNowTick();

  const isRefreshing = Boolean(refreshingIds[account.id]);
  const balance = account.balance;
  const infos = balance?.balanceInfos || [];
  const status = getDeepSeekStatusBadge(balance);
  const displayName = account.name || account.keyPreview || 'DeepSeek 账号';

  return (
    <div className="flex w-full flex-col rounded-2xl border border-neutral-200/90 bg-card shadow-xs transition-all duration-150 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3.5 dark:border-neutral-800/80">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <ProviderLogo provider="deepseek" size="avatar" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100"
                title={displayName}
              >
                {displayName}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${getDeepSeekBadgeClass(
                  status.tone
                )}`}
              >
                {status.label}
              </span>
            </div>

            <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
              {account.keyPreview && (
                <>
                  <span className="truncate font-mono text-[10px]" title={account.keyPreview}>
                    {account.keyPreview}
                  </span>
                  <span className="text-neutral-300 dark:text-neutral-700">·</span>
                </>
              )}
              <span className="flex shrink-0 items-center gap-1" title={balance?.lastRefreshedAt}>
                <Clock className="h-2.5 w-2.5" />
                {formatRelativeTime(balance?.lastRefreshedAt, nowMs)}
              </span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => refreshAccount(account.id)}
            disabled={isRefreshing}
            aria-label={`刷新 DeepSeek 账号 ${displayName} 余额`}
            title="刷新余额"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-600 shadow-2xs transition-colors hover:bg-neutral-50 hover:text-neutral-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => onEdit(account)}
            aria-label={`编辑 DeepSeek 账号 ${displayName}`}
            title="修改别名或更换 API Key"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-600 shadow-2xs transition-colors hover:bg-neutral-50 hover:text-neutral-900 active:scale-[0.98] dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => confirmDeleteAccount(account)}
            aria-label={`移除 DeepSeek 账号 ${displayName}`}
            title="移除账号与本地凭据"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-500 shadow-2xs transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98] dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-400 dark:hover:border-rose-900/50 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Invalid API Key Banner */}
        {balance?.authInvalid && (
          <div className="flex items-center justify-between gap-2.5 rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/45 dark:text-amber-300">
            <span className="inline-flex min-w-0 items-center gap-2">
              <KeyRound className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {balance.errorMessage || 'API Key 无效或已失效，请前往设置更新'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => onEdit(account)}
              className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-neutral-950 dark:hover:bg-amber-400"
            >
              更新 Key
            </button>
          </div>
        )}

        {/* Currency Balance Blocks */}
        {infos.length > 0 ? (
          <div
            className={`grid gap-3 ${adaptiveGridCols(
              infos.length,
              'grid-cols-1 sm:grid-cols-2'
            )} ${balance?.authInvalid ? 'opacity-65' : ''}`}
          >
            {infos.map((info) => {
              const tone = getBalanceInfoTone(Boolean(balance?.isAvailable), info);
              return (
                <div
                  key={info.currency}
                  className="rounded-xl border border-neutral-200/75 bg-neutral-50/60 p-3.5 dark:border-neutral-800/80 dark:bg-neutral-950/45"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                      总可用余额
                    </span>
                    <span className="rounded bg-neutral-200/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                      {info.currency}
                    </span>
                  </div>

                  <div
                    className={`mt-1.5 font-mono text-2xl font-bold tracking-tight tabular-nums ${getDeepSeekAmountColorClass(
                      tone
                    )}`}
                  >
                    {formatCurrencyAmount(info.currency, info.totalBalance)}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-neutral-200/70 pt-2.5 dark:border-neutral-800/80">
                    <div>
                      <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
                        充值余额
                      </div>
                      <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">
                        {formatCurrencyAmount(info.currency, info.toppedUpBalance)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
                        赠金余额
                      </div>
                      <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">
                        {formatCurrencyAmount(info.currency, info.grantedBalance)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 py-6 text-center text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
            <Wallet className="h-5 w-5 opacity-70" />
            <p className="mt-1.5 text-xs">暂无币种余额明细</p>
          </div>
        )}

        {/* Non-auth Refresh Error Banner */}
        {!balance?.authInvalid && balance?.errorMessage && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200/80 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/35 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="leading-relaxed">{balance.errorMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};
