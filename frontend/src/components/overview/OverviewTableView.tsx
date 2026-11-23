import React, { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowRightLeft,
  KeyRound,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { ProviderLogo } from '../ProviderLogo';
import { ResetTimeText } from '../ResetTimeText';
import { BestAntigravitySwitchBar, shortBucketWindow } from './ProviderBentoCards';
import { ThinQuotaBar } from './ThinQuotaBar';
import { useAccountStore } from '../../store/useAccountStore';
import { useDeepSeekStore } from '../../store/useDeepSeekStore';
import { useOverviewPrefsStore } from '../../store/useOverviewPrefsStore';
import { useQianwenStore } from '../../store/useQianwenStore';
import { useResetTimeStore } from '../../store/useResetTimeStore';
import { openSettingsModal } from '../../store/useSettingsModalStore';
import {
  formatCurrencyAmount,
  getBalanceInfoTone,
  getDeepSeekAmountColorClass,
  getDeepSeekBadgeClass,
  getDeepSeekStatusBadge,
  maskDeepSeekKeyPreview,
} from '../../utils/deepseek';
import { adaptiveGridCols } from '../../utils/layout';
import {
  formatQuotaByMode,
  formatRelativeTime,
  getQuotaTextColor,
  maskAccountIdentity,
  sortAntigravityAccounts,
} from '../../utils/quota';

interface OverviewTableViewProps {
  nowMs: number;
}

const ProviderTableColGroup: React.FC = () => (
  <colgroup>
    <col className="w-[190px]" />
    <col className="w-[96px]" />
    <col />
    <col className="w-[132px]" />
    <col className="w-[116px]" />
  </colgroup>
);

const QuotaRow: React.FC<{
  label: string;
  formatted: ReturnType<typeof formatQuotaByMode>;
}> = ({ label, formatted }) => (
  <div className="flex items-center gap-2 text-[10px]">
    <span
      className="w-[88px] shrink-0 truncate text-neutral-500 dark:text-neutral-400"
      title={label}
    >
      {label}
    </span>
    <div className="min-w-0 flex-1">
      <ThinQuotaBar barPct={formatted.barPct} remainingPct={formatted.remainingPct} />
    </div>
    <span
      className={`w-9 shrink-0 text-right font-mono font-semibold tabular-nums ${getQuotaTextColor(
        formatted.remainingPct
      )}`}
    >
      {formatted.shortValue}
    </span>
  </div>
);
export const OverviewTableView: React.FC<OverviewTableViewProps> = ({ nowMs }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const resetTimeFormat = useResetTimeStore((s) => s.resetTimeFormat);
  const quotaDisplayMode = useOverviewPrefsStore((s) => s.quotaDisplayMode);
  const maskAccount = useOverviewPrefsStore((s) => s.maskAccount);
  const bestDimension = useOverviewPrefsStore((s) => s.bestDimension);

  const {
    accounts: agAccounts,
    refreshingAll: agRefreshingAll,
    refreshingIds: agRefreshingIds,
    switchingIds: agSwitchingIds,
    refreshAccountQuota: refreshAgAccount,
    refreshAllQuotas: refreshAllAg,
    switchAccount,
  } = useAccountStore();

  const {
    accounts: qwAccounts,
    refreshingAll: qwRefreshingAll,
    refreshingIds: qwRefreshingIds,
    refreshAccount: refreshQwAccount,
    refreshAllAccounts: refreshAllQw,
  } = useQianwenStore();

  const {
    accounts: dsAccounts,
    refreshingAll: dsRefreshingAll,
    refreshingIds: dsRefreshingIds,
    refreshAccount: refreshDsAccount,
    refreshAllAccounts: refreshAllDs,
  } = useDeepSeekStore();

  const sortedAgAccounts = useMemo(
    () => sortAntigravityAccounts(agAccounts, bestDimension, { pinCurrent: true }),
    [agAccounts, bestDimension]
  );

  const anySwitching = Object.values(agSwitchingIds).some(Boolean);
  const quotaColLabel = `核心配额（${quotaDisplayMode === 'used' ? '已用' : '剩余'}）`;

  return (
    <div className="space-y-4">
      {/* Antigravity Provider Table Section */}
      {agAccounts.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-neutral-200/85 bg-card shadow-xs dark:border-neutral-800/90 dark:bg-neutral-900/90">
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-neutral-200/80 px-4 py-3 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => navigate('/quota/antigravity')}
              className="group inline-flex min-w-0 items-center gap-2 text-left"
            >
              <ProviderLogo provider="antigravity" size="sm" />
              <span className="truncate text-sm font-semibold tracking-tight text-neutral-900 group-hover:underline dark:text-neutral-100">
                Antigravity
              </span>
              <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                {agAccounts.length}
              </span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {agAccounts.length >= 2 && (
                <>
                  <BestAntigravitySwitchBar accounts={agAccounts} layoutIdPrefix="table-ag-best" />
                  <span
                    aria-hidden="true"
                    className="hidden h-4 w-px bg-neutral-200 sm:inline-block dark:bg-neutral-800"
                  />
                </>
              )}
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void refreshAllAg()}
                  disabled={agRefreshingAll}
                  title="刷新全部 Antigravity 账号"
                  aria-label="刷新全部 Antigravity 账号"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                >
                  <RefreshCw className={`h-3 w-3 ${agRefreshingAll ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/quota/antigravity')}
                  title="查看 Antigravity 额度详情"
                  className="inline-flex h-6 items-center gap-0.5 rounded-md px-1.5 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  <span>详情</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] table-fixed border-collapse text-left text-xs">
              <ProviderTableColGroup />
              <thead>
                <tr className="border-b border-neutral-200/80 bg-neutral-50/70 text-[11px] font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-neutral-400">
                  <th className="px-4 py-2.5">账号</th>
                  <th className="px-3 py-2.5">套餐 / 状态</th>
                  <th className="px-4 py-2.5">{quotaColLabel}</th>
                  <th className="px-3 py-2.5">重置 / 更新</th>
                  <th className="px-4 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                {sortedAgAccounts.map((acc) => {
                  const isRefreshing = Boolean(agRefreshingIds[acc.id]);
                  const isSwitching = Boolean(agSwitchingIds[acc.id]);
                  const displayEmail = maskAccount ? maskAccountIdentity(acc.email) : acc.email;
                  const tier = acc.subscriptionTier || 'FREE';

                  const allGroups = (acc.groups || []).filter(
                    (g) => g.buckets && g.buckets.length > 0
                  );
                  const filterByDimension = agAccounts.length >= 2;
                  const visibleGroups = filterByDimension
                    ? allGroups.filter((g) =>
                        (g.displayName || '').toLowerCase().includes(bestDimension)
                      )
                    : allGroups;

                  const groupItems: {
                    label: string;
                    remainingPct: number;
                    resetTime?: string;
                  }[] = [];

                  for (const g of visibleGroups) {
                    const buckets = g.buckets || [];
                    if (filterByDimension && buckets.length > 1) {
                      for (const b of buckets) {
                        groupItems.push({
                          label: `${g.displayName || '模型组'} · ${shortBucketWindow(b)}`,
                          remainingPct: Math.round(b.remainingFraction * 100),
                          resetTime: b.resetTime,
                        });
                      }
                    } else {
                      const pct = Math.min(
                        ...buckets.map((b) => Math.round(b.remainingFraction * 100))
                      );
                      groupItems.push({
                        label: g.displayName || '模型组',
                        remainingPct: pct,
                        resetTime: buckets[0]?.resetTime,
                      });
                    }
                  }

                  const earliestReset =
                    groupItems.find((g) => g.resetTime)?.resetTime || acc.resetTime;

                  return (
                    <tr
                      key={`ag-${acc.id}`}
                      className={`transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-800/35 ${
                        acc.isCurrent ? 'bg-emerald-50/30 dark:bg-emerald-950/15' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-1.5">
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
                      <td className="px-4 py-3">
                        {groupItems.length > 0 ? (
                          <div
                            className={`grid gap-y-1.5 ${adaptiveGridCols(
                              groupItems.length,
                              'grid-cols-1'
                            )}`}
                          >
                            {groupItems.map((item) => {
                              const formatted = formatQuotaByMode(
                                item.remainingPct,
                                quotaDisplayMode
                              );
                              return (
                                <QuotaRow key={item.label} label={item.label} formatted={formatted} />
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                            {acc.errorMessage ||
                              (filterByDimension && allGroups.length > 0
                                ? `暂无 ${bestDimension === 'claude' ? 'Claude' : 'Gemini'} 配额数据`
                                : '暂无配额数据')}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-[11px]"><div className="truncate text-neutral-500 dark:text-neutral-400">
                        {earliestReset ? (
                          <ResetTimeText
                            resetTime={earliestReset}
                            format={resetTimeFormat}
                            nowMs={nowMs}
                          />
                        ) : (
                          '—'
                        )}
                      </div><div className="mt-0.5 hidden truncate text-[10px] text-neutral-400 xl:block dark:text-neutral-500">更新于 {formatRelativeTime(acc.lastRefreshedAt, nowMs)}</div></td>
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Qianwen Provider Table Section */}
      {qwAccounts.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-neutral-200/85 bg-card shadow-xs dark:border-neutral-800/90 dark:bg-neutral-900/90">
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-neutral-200/80 px-4 py-3 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => navigate('/quota/qianwen')}
              className="group inline-flex min-w-0 items-center gap-2 text-left"
            >
              <ProviderLogo provider="qianwen" size="sm" />
              <span className="truncate text-sm font-semibold tracking-tight text-neutral-900 group-hover:underline dark:text-neutral-100">
                千问 · Token Plan
              </span>
              <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                {qwAccounts.length}
              </span>
            </button>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => void refreshAllQw()}
                disabled={qwRefreshingAll}
                title="刷新全部千问账号"
                aria-label="刷新全部千问账号"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <RefreshCw className={`h-3 w-3 ${qwRefreshingAll ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => navigate('/quota/qianwen')}
                title="查看千问额度详情"
                className="inline-flex h-6 items-center gap-0.5 rounded-md px-1.5 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              >
                <span>详情</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] table-fixed border-collapse text-left text-xs">
              <ProviderTableColGroup />
              <thead>
                <tr className="border-b border-neutral-200/80 bg-neutral-50/70 text-[11px] font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-neutral-400">
                  <th className="px-4 py-2.5">账号</th>
                  <th className="px-3 py-2.5">套餐 / 状态</th>
                  <th className="px-4 py-2.5">{quotaColLabel}</th>
                  <th className="px-3 py-2.5">重置 / 更新</th>
                  <th className="px-4 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
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
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3">
                        {quota?.authExpired ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                            <KeyRound className="h-3 w-3 shrink-0" />
                            授权已过期
                          </span>
                        ) : hasPersonal && personal?.cycles?.length ? (
                          <div
                            className={`grid gap-y-1.5 ${adaptiveGridCols(
                              personal.cycles.length,
                              'grid-cols-1'
                            )}`}
                          >
                            {personal.cycles.map((c) => {
                              const formatted = formatQuotaByMode(
                                Math.round(c.remainingPercentage),
                                quotaDisplayMode
                              );
                              return (
                                <QuotaRow key={c.cycle} label={c.label || c.cycle} formatted={formatted} />
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
                              <div className="space-y-0.5">
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
                      <td className="whitespace-nowrap px-3 py-3 text-[11px]"><div className="truncate text-neutral-500 dark:text-neutral-400">
                        {earliestReset ? (
                          <ResetTimeText
                            resetTime={earliestReset}
                            format={resetTimeFormat}
                            nowMs={nowMs}
                          />
                        ) : (
                          '—'
                        )}
                      </div><div className="mt-0.5 hidden truncate text-[10px] text-neutral-400 xl:block dark:text-neutral-500">更新于 {formatRelativeTime(quota?.lastRefreshedAt, nowMs)}</div></td>
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* DeepSeek Provider Table Section */}
      {dsAccounts.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-neutral-200/85 bg-card shadow-xs dark:border-neutral-800/90 dark:bg-neutral-900/90">
          <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-neutral-200/80 px-4 py-3 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => navigate('/quota/deepseek')}
              className="group inline-flex min-w-0 items-center gap-2 text-left"
            >
              <ProviderLogo provider="deepseek" size="sm" />
              <span className="truncate text-sm font-semibold tracking-tight text-neutral-900 group-hover:underline dark:text-neutral-100">
                DeepSeek
              </span>
              <span className="rounded-md bg-blue-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
                {dsAccounts.length}
              </span>
            </button>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => void refreshAllDs()}
                disabled={dsRefreshingAll}
                title="刷新全部 DeepSeek 账号"
                aria-label="刷新全部 DeepSeek 账号"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <RefreshCw className={`h-3 w-3 ${dsRefreshingAll ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => navigate('/quota/deepseek')}
                title="查看 DeepSeek 余额详情"
                className="inline-flex h-6 items-center gap-0.5 rounded-md px-1.5 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              >
                <span>详情</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] table-fixed border-collapse text-left text-xs">
              <ProviderTableColGroup />
              <thead>
                <tr className="border-b border-neutral-200/80 bg-neutral-50/70 text-[11px] font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950/60 dark:text-neutral-400">
                  <th className="px-4 py-2.5">账号</th>
                  <th className="px-3 py-2.5">状态</th>
                  <th className="px-4 py-2.5">账户余额（总余额 / 充值 / 赠金）</th>
                  <th className="px-3 py-2.5">更新时间</th>
                  <th className="px-4 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                {dsAccounts.map((acc) => {
                  const isRefreshing = Boolean(dsRefreshingIds[acc.id]);
                  const balance = acc.balance;
                  const infos = balance?.balanceInfos || [];
                  const status = getDeepSeekStatusBadge(balance);
                  const rawName = acc.name || acc.keyPreview || 'DeepSeek 账号';
                  const displayName = maskAccount ? maskAccountIdentity(rawName) : rawName;
                  const displayKey = maskAccount
                    ? maskDeepSeekKeyPreview(acc.keyPreview)
                    : acc.keyPreview;

                  return (
                    <tr
                      key={`ds-${acc.id}`}
                      className="transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-800/35"
                    >
                      <td className="px-4 py-3">
                        <div className="min-w-0">
                          <span
                            className="block truncate font-medium text-neutral-900 dark:text-neutral-100"
                            title={maskAccount ? undefined : rawName}
                          >
                            {displayName}
                          </span>
                          {displayKey && (
                            <span className="block truncate font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
                              {displayKey}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${getDeepSeekBadgeClass(
                            status.tone
                          )}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {balance?.authInvalid ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                            <KeyRound className="h-3 w-3 shrink-0" />
                            API Key 已失效
                          </span>
                        ) : infos.length > 0 ? (
                          <div className="space-y-1">
                            {infos.map((info) => {
                              const tone = getBalanceInfoTone(
                                Boolean(balance?.isAvailable),
                                info
                              );
                              return (
                                <div
                                  key={info.currency}
                                  className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5"
                                >
                                  <span
                                    className={`font-mono text-xs font-bold tabular-nums ${getDeepSeekAmountColorClass(
                                      tone
                                    )}`}
                                  >
                                    {formatCurrencyAmount(info.currency, info.totalBalance)}
                                  </span>
                                  <span className="font-mono text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
                                    充值 {formatCurrencyAmount(info.currency, info.toppedUpBalance)}
                                  </span>
                                  <span className="font-mono text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
                                    赠金 {formatCurrencyAmount(info.currency, info.grantedBalance)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                            {balance?.errorMessage || '暂无余额明细'}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                        {formatRelativeTime(balance?.lastRefreshedAt, nowMs)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {balance?.authInvalid && (
                            <button
                              type="button"
                              onClick={() =>
                                openSettingsModal(navigate, location, 'providers', {
                                  provider: 'deepseek',
                                  action: 'edit',
                                  deepseekAccountId: acc.id,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-neutral-950 dark:hover:bg-amber-400"
                            >
                              <KeyRound className="h-3 w-3" />
                              <span>更新 Key</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void refreshDsAccount(acc.id)}
                            disabled={isRefreshing}
                            title="刷新 DeepSeek 余额"
                            aria-label={`刷新 ${displayName} 余额`}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-neutral-200 bg-card text-neutral-600 hover:bg-neutral-100 disabled:opacity-45 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                          >
                            <RefreshCw
                              className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
                            />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};
