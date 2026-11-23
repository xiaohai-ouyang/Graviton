import React from 'react';
import {
  AlertCircle,
  CalendarClock,
  Clock,
  KeyRound,
  PackageX,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { useNowTick } from '../hooks/useNowTick';
import { useQianwenStore } from '../store/useQianwenStore';
import { useResetTimeStore } from '../store/useResetTimeStore';
import { QianwenAccountDisplay } from '../types';
import { formatRelativeTime, getQuotaTextColor } from '../utils/quota';
import { ProviderLogo } from './ProviderLogo';
import { QuotaProgressBar } from './QuotaProgressBar';
import { ResetTimeText } from './ResetTimeText';

interface QianwenAccountCardProps {
  account: QianwenAccountDisplay;
  onReauth: (account: QianwenAccountDisplay) => void;
}

function formatDateOnly(isoStr?: string): string {
  if (!isoStr) return '未知';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const QianwenAccountCard: React.FC<QianwenAccountCardProps> = ({
  account,
  onReauth,
}) => {
  const { refreshingIds, refreshAccount, confirmDeleteAccount } = useQianwenStore();
  const resetTimeFormat = useResetTimeStore((s) => s.resetTimeFormat);
  const nowMs = useNowTick();

  const isRefreshing = Boolean(refreshingIds[account.id]);
  const quota = account.quota;
  const personal = quota?.personal;
  const team = quota?.team;
  const hasPersonal = personal?.status === 'active';
  const hasTeam = team?.status === 'active';

  const displayName = account.name || account.email || account.aliyunId || '千问账号';
  const subLabel =
    account.email && account.aliyunId && account.email !== account.aliyunId
      ? `ID: ${account.aliyunId}`
      : account.aliyunId && displayName !== account.aliyunId
        ? `ID: ${account.aliyunId}`
        : '';

  const tierLabel = hasPersonal
    ? personal?.planName || personal?.specCode || '个人版'
    : hasTeam
      ? team?.planName || '团队版'
      : '未订阅';

  return (
    <div className="flex w-full flex-col rounded-2xl border border-neutral-200/90 bg-card shadow-xs transition-all duration-150 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3.5 dark:border-neutral-800/80">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <ProviderLogo provider="qianwen" size="avatar" />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span
                className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100"
                title={displayName}
              >
                {displayName}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase ${
                  hasPersonal || hasTeam
                    ? 'bg-indigo-600 text-white dark:bg-indigo-500 dark:text-white'
                    : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                }`}
              >
                {tierLabel}
              </span>
            </div>

            <div className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
              {subLabel && (
                <>
                  <span className="truncate" title={subLabel}>
                    {subLabel}
                  </span>
                  <span className="text-neutral-300 dark:text-neutral-700">·</span>
                </>
              )}
              <span className="flex shrink-0 items-center gap-1" title={quota?.lastRefreshedAt}>
                <Clock className="h-2.5 w-2.5" />
                {formatRelativeTime(quota?.lastRefreshedAt, nowMs)}
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
            aria-label={`刷新千问账号 ${displayName} 额度`}
            title="刷新千问额度"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-600 shadow-2xs transition-colors hover:bg-neutral-50 hover:text-neutral-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => confirmDeleteAccount(account)}
            disabled={isRefreshing}
            aria-label={`移除千问账号 ${displayName}`}
            title="移除账号"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-500 shadow-2xs transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-400 dark:hover:border-rose-900/50 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {quota?.authExpired && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
            <div className="flex items-center gap-2 min-w-0">
              <KeyRound className="h-4 w-4 shrink-0" />
              <span className="truncate">授权已过期，请重新授权后再查询</span>
            </div>
            <button
              type="button"
              onClick={() => onReauth(account)}
              className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-neutral-950 dark:hover:bg-amber-400"
            >
              重新授权
            </button>
          </div>
        )}

        {/* Personal Plan Section */}
        {hasPersonal && personal && (
          <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 p-3 dark:border-neutral-800/80 dark:bg-neutral-950/50">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                  个人版 · {personal.planName || personal.specCode}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    personal.autoRenew
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-neutral-200/70 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                  }`}
                >
                  {personal.autoRenew ? '自动续费' : '手动续费'}
                </span>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                <CalendarClock className="h-3 w-3" />
                到期 {formatDateOnly(personal.endTime)}（剩 {personal.remainingDays} 天）
              </span>
            </div>

            {personal.cycles && personal.cycles.length > 0 ? (
              <div className="space-y-2.5">
                {personal.cycles.map((cycle) => {
                  const remPct = Math.round(cycle.remainingPercentage);
                  const usedPct = Math.round(cycle.usedPercentage);
                  return (
                    <div key={cycle.cycle} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-medium text-neutral-700 dark:text-neutral-300">
                          {cycle.label || cycle.cycle}
                          {cycle.totalQuota ? (
                            <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                              (配额基数 {cycle.totalQuota})
                            </span>
                          ) : null}
                        </span>
                        <div className="flex items-center gap-2">
                          {cycle.resetTime && (
                            <ResetTimeText
                              resetTime={cycle.resetTime}
                              format={resetTimeFormat}
                              nowMs={nowMs}
                              className="text-[10px] text-neutral-400 dark:text-neutral-500"
                            />
                          )}
                          <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
                            已用 {usedPct}%
                          </span>
                          <span className={`font-semibold ${getQuotaTextColor(remPct)}`}>
                            剩 {remPct}%
                          </span>
                        </div>
                      </div>
                      <QuotaProgressBar
                        percentage={remPct}
                        size="sm"
                        ariaLabel={`${cycle.label}剩余 ${remPct}%`}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
                暂未获取到周期用量数据
              </p>
            )}
          </div>
        )}

        {/* Team Plan Section */}
        {hasTeam && team && (
          <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 p-3 dark:border-neutral-800/80 dark:bg-neutral-950/50">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-indigo-500" />
                <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                  {team.planName || '团队版 Token Plan'}
                </span>
                {typeof team.autoRenew === 'boolean' && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      team.autoRenew
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-neutral-200/70 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                    }`}
                  >
                    {team.autoRenew ? '自动续费' : '未自动续费'}
                  </span>
                )}
              </div>
              {team.endTime && (
                <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  <CalendarClock className="h-3 w-3" />
                  到期 {formatDateOnly(team.endTime)}
                  {team.remainingDays > 0 ? `（剩 ${team.remainingDays} 天）` : ''}
                </span>
              )}
            </div>

            {team.totalCredits > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                    Credits 余量（{team.remainingCredits} / {team.totalCredits}）
                  </span>
                  <div className="flex items-center gap-2">
                    {team.resetTime && (
                      <ResetTimeText
                        resetTime={team.resetTime}
                        format={resetTimeFormat}
                        nowMs={nowMs}
                        className="text-[10px] text-neutral-400 dark:text-neutral-500"
                      />
                    )}
                    <span
                      className={`font-semibold ${getQuotaTextColor(
                        Math.round(team.remainingPercentage)
                      )}`}
                    >
                      剩 {Math.round(team.remainingPercentage)}%
                    </span>
                  </div>
                </div>
                <QuotaProgressBar
                  percentage={Math.round(team.remainingPercentage)}
                  size="sm"
                  ariaLabel={`团队 Credits 剩余 ${Math.round(team.remainingPercentage)}%`}
                />
              </div>
            )}

            {team.addonRemaining > 0 && (
              <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-600 dark:text-neutral-400">
                <span>加量包剩余 Credits</span>
                <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                  {team.addonRemaining}
                </span>
              </div>
            )}

            {team.seatGroups && team.seatGroups.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-neutral-200/70 pt-2 dark:border-neutral-800">
                {team.seatGroups.map((sg, idx) => (
                  <div
                    key={`${sg.specType}-${idx}`}
                    className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400"
                  >
                    <span>
                      席位 {sg.specType}（已分配 {sg.assigned}/{sg.seats}）
                    </span>
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">
                      {sg.remainingCredits}/{sg.totalCredits} Credits
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* No active subscription */}
        {!hasPersonal && !hasTeam && !quota?.authExpired && (
          <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 px-3.5 py-4 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/30 dark:text-neutral-400">
            <PackageX className="h-4 w-4 shrink-0 text-neutral-400" />
            <span>当前账号暂无有效的 Token Plan 套餐订阅（个人版 / 团队版均未开通或已到期）。</span>
          </div>
        )}

        {/* Non-auth error message */}
        {quota?.errorMessage && !quota?.authExpired && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200/80 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-all">{quota.errorMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
};
