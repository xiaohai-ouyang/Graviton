import React, { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowRightLeft,
  KeyRound,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { ResetTimeText } from '../ResetTimeText';
import { BestAntigravitySwitchBar } from './ProviderBentoCards';
import { ThinQuotaBar } from './ThinQuotaBar';
import { useAccountStore } from '../../store/useAccountStore';
import { useOverviewPrefsStore } from '../../store/useOverviewPrefsStore';
import { useQianwenStore } from '../../store/useQianwenStore';
import { useResetTimeStore } from '../../store/useResetTimeStore';
import { openSettingsModal } from '../../store/useSettingsModalStore';
import {
  formatQuotaByMode,
  formatRelativeTime,
  getAccountOverallScore,
  getQuotaTextColor,
  maskAccountIdentity,
} from '../../utils/quota';

interface OverviewTableViewProps {
  nowMs: number;
}

export const OverviewTableView: React.FC<OverviewTableViewProps> = ({ nowMs }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const resetTimeFormat = useResetTimeStore((s) => s.resetTimeFormat);
  const quotaDisplayMode = useOverviewPrefsStore((s) => s.quotaDisplayMode);
  const maskAccount = useOverviewPrefsStore((s) => s.maskAccount);

  const {
    accounts: agAccounts,
    refreshingIds: agRefreshingIds,
    switchingIds: agSwitchingIds,
    refreshAccountQuota: refreshAgAccount,
    switchAccount,
  } = useAccountStore();

  const {
    accounts: qwAccounts,
    refreshingIds: qwRefreshingIds,
    refreshAccount: refreshQwAccount,
  } = useQianwenStore();

  const sortedAgAccounts = useMemo(() => {
    return [...agAccounts].sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return Number(b.isCurrent) - Number(a.isCurrent);
      return getAccountOverallScore(b).avg - getAccountOverallScore(a).avg;
    });
  }, [agAccounts]);

  const anySwitching = Object.values(agSwitchingIds).some(Boolean);

  return (
    <div className="space-y-3">
      {agAccounts.length >= 2 && (
        <div className="rounded-xl border border-neutral-200/85 bg-card px-4 py-2.5 shadow-2xs dark:border-neutral-800/90 dark:bg-neutral-900/90">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              Antigravity 快捷切号
            </span>
            <BestAntigravitySwitchBar accounts={agAccounts} layoutIdPrefix="table-ag-best" />
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-neutral-200/85 bg-card shadow-xs dark:border-neutral-800/90 dark:bg-neutral-900/90">
        <table className="w-full min-w-[760px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-neutral-200/80 bg-neutral-50/70 text-[11px] font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-neutral-400">
              <th className="px-4 py-2.5">供应商</th>
              <th className="px-4 py-2.5">账号</th>
              <th className="px-3 py-2.5">套餐 / 状态</th>
              <th className="px-4 py-2.5">
                核心配额（{quotaDisplayMode === 'used' ? '已用' : '剩余'}）
              </th>
              <th className="px-3 py-2.5">最近重置</th>
              <th className="px-3 py-2.5">更新时间</th>
              <th className="px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
            {sortedAgAccounts.map((acc) => {
              const isRefreshing = Boolean(agRefreshingIds[acc.id]);
              const isSwitching = Boolean(agSwitchingIds[acc.id]);
              const displayEmail = maskAccount ? maskAccountIdentity(acc.email) : acc.email;
              const tier = acc.subscriptionTier || 'FREE';

              const groupItems = (acc.groups || [])
                .filter((g) => g.buckets && g.buckets.length > 0)
                .map((g) => {
                  const pct = Math.min(
                    ...g.buckets!.map((b) => Math.round(b.remainingFraction * 100))
                  );
                  return {
                    label: g.displayName || '模型组',
                    remainingPct: pct,
                    resetTime: g.buckets![0]?.resetTime,
                  };
                });

              const earliestReset =
                acc.resetTime || groupItems.find((g) => g.resetTime)?.resetTime;

              return (
                <tr
                  key={`ag-${acc.id}`}
                  className={`transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-800/35 ${
                    acc.isCurrent ? 'bg-emerald-50/30 dark:bg-emerald-950/15' : ''
                  }`}
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
                      Antigravity
                    </span>
                  </td>
                  <td className="max-w-[200px] px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {acc.isCurrent && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                          title="当前使用中"
                        />
                      )}
                      <span
                        className="truncate font-medium text-neutral-900 dark:text-neutral-100"
                        title={maskAccount ? undefined : acc.email}
                      >
                        {displayEmail}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                        {tier}
                      </span>
                      {acc.isForbidden && (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:bg-rose-950/60 dark:text-rose-300">
                          受限
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="min-w-[240px] px-4 py-3">
                    {groupItems.length > 0 ? (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        {groupItems.map((item) => {
                          const formatted = formatQuotaByMode(
                            item.remainingPct,
                            quotaDisplayMode
                          );
                          return (
                            <div key={item.label} className="space-y-0.5">
                              <div className="flex items-baseline justify-between gap-1 text-[10px]">
                                <span className="truncate text-neutral-500 dark:text-neutral-400">
                                  {item.label}
                                </span>
                                <span
                                  className={`font-mono font-semibold tabular-nums ${getQuotaTextColor(
                                    formatted.remainingPct
                                  )}`}
                                >
                                  {formatted.shortValue}
                                </span>
                              </div>
                              <ThinQuotaBar
                                barPct={formatted.barPct}
                                remainingPct={formatted.remainingPct}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                        {acc.errorMessage || '暂无配额数据'}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                    {earliestReset ? (
                      <ResetTimeText
                        resetTime={earliestReset}
                        format={resetTimeFormat}
                        nowMs={nowMs}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[11px] text-neutral-400 dark:text-neutral-500">
                    {formatRelativeTime(acc.lastRefreshedAt, nowMs)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {!acc.isCurrent && !acc.isForbidden && (
                        <button
                          type="button"
                          onClick={() => void switchAccount(acc.id)}
                          disabled={anySwitching || isRefreshing}
                          className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-card px-2 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-45 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                        >
                          {isSwitching ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <ArrowRightLeft className="h-3 w-3" />
                          )}
                          <span>切换</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void refreshAgAccount(acc.id)}
                        disabled={isRefreshing || isSwitching}
                        title="刷新额度"
                        aria-label={`刷新 ${displayEmail} 额度`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-card text-neutral-600 hover:bg-neutral-100 disabled:opacity-45 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate('/quota/antigravity')}
                        title="进入 Antigravity 额度页"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {qwAccounts.map((acc) => {
              const isRefreshing = Boolean(qwRefreshingIds[acc.id]);
              const quota = acc.quota;
              const personal = quota?.personal;
              const team = quota?.team;
              const hasPersonal = personal?.status === 'active';
              const hasTeam = team?.status === 'active';
              const rawName = acc.name || acc.email || acc.aliyunId || '千问账号';
              const displayName = maskAccount ? maskAccountIdentity(rawName) : rawName;
              const tierLabel = hasPersonal
                ? personal?.planName || personal?.specCode || '个人版'
                : hasTeam
                  ? team?.planName || '团队版'
                  : '未订阅';

              const earliestReset =
                (hasPersonal && personal?.cycles?.find((c) => c.resetTime)?.resetTime) ||
                (hasTeam ? team?.resetTime : undefined);

              return (
                <tr
                  key={`qw-${acc.id}`}
                  className="transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-800/35"
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-indigo-500">
                      千问
                    </span>
                  </td>
                  <td className="max-w-[200px] px-4 py-3">
                    <span
                      className="block truncate font-medium text-neutral-900 dark:text-neutral-100"
                      title={maskAccount ? undefined : rawName}
                    >
                      {displayName}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          hasPersonal || hasTeam
                            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300'
                            : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                        }`}
                      >
                        {tierLabel}
                      </span>
                      {quota?.authExpired && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
                          已过期
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="min-w-[240px] px-4 py-3">
                    {quota?.authExpired ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                        <KeyRound className="h-3 w-3 shrink-0" />
                        授权已过期
                      </span>
                    ) : hasPersonal && personal?.cycles?.length ? (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        {personal.cycles.map((c) => {
                          const formatted = formatQuotaByMode(
                            Math.round(c.remainingPercentage),
                            quotaDisplayMode
                          );
                          return (
                            <div key={c.cycle} className="space-y-0.5">
                              <div className="flex items-baseline justify-between gap-1 text-[10px]">
                                <span className="truncate text-neutral-500 dark:text-neutral-400">
                                  {c.label || c.cycle}
                                </span>
                                <span
                                  className={`font-mono font-semibold tabular-nums ${getQuotaTextColor(
                                    formatted.remainingPct
                                  )}`}
                                >
                                  {formatted.shortValue}
                                </span>
                              </div>
                              <ThinQuotaBar
                                barPct={formatted.barPct}
                                remainingPct={formatted.remainingPct}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : hasTeam && team && team.totalCredits > 0 ? (
                      (() => {
                        const formatted = formatQuotaByMode(
                          Math.round(team.remainingPercentage),
                          quotaDisplayMode
                        );
                        return (
                          <div className="max-w-[220px] space-y-0.5">
                            <div className="flex items-baseline justify-between text-[10px]">
                              <span className="text-neutral-500 dark:text-neutral-400">
                                团队 Credits
                              </span>
                              <span
                                className={`font-mono font-semibold tabular-nums ${getQuotaTextColor(
                                  formatted.remainingPct
                                )}`}
                              >
                                {formatted.shortValue}
                              </span>
                            </div>
                            <ThinQuotaBar
                              barPct={formatted.barPct}
                              remainingPct={formatted.remainingPct}
                            />
                          </div>
                        );
                      })()
                    ) : (
                      <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                        {quota?.errorMessage || '暂无有效订阅'}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                    {earliestReset ? (
                      <ResetTimeText
                        resetTime={earliestReset}
                        format={resetTimeFormat}
                        nowMs={nowMs}
                      />
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[11px] text-neutral-400 dark:text-neutral-500">
                    {formatRelativeTime(quota?.lastRefreshedAt, nowMs)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-1.5">
                      {quota?.authExpired && (
                        <button
                          type="button"
                          onClick={() =>
                            openSettingsModal(navigate, location, 'providers', {
                              provider: 'qianwen',
                              action: 'reauth',
                              qianwenAccountId: acc.id,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-neutral-950 dark:hover:bg-amber-400"
                        >
                          <KeyRound className="h-3 w-3" />
                          <span>重授权</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void refreshQwAccount(acc.id)}
                        disabled={isRefreshing}
                        title="刷新千问额度"
                        aria-label={`刷新 ${displayName} 额度`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-card text-neutral-600 hover:bg-neutral-100 disabled:opacity-45 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate('/quota/qianwen')}
                        title="进入千问额度页"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
