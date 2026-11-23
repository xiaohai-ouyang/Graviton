import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { ResetTimeText } from '../ResetTimeText';
import { ThinQuotaBar } from './ThinQuotaBar';
import { useAccountStore } from '../../store/useAccountStore';
import { useMotionStore } from '../../store/useMotionStore';
import { useOverviewPrefsStore } from '../../store/useOverviewPrefsStore';
import { useQianwenStore } from '../../store/useQianwenStore';
import { useResetTimeStore } from '../../store/useResetTimeStore';
import { openSettingsModal } from '../../store/useSettingsModalStore';
import { AccountDisplay, QianwenAccountDisplay, QuotaBucket } from '../../types';
import {
  aggregateAntigravityGroups,
  BestAccountDimension,
  formatQuotaByMode,
  formatRelativeTime,
  getQuotaTextColor,
  maskAccountIdentity,
  pickBestAntigravityAccount,
  sortAntigravityAccounts,
} from '../../utils/quota';

const DEFAULT_VISIBLE_ACCOUNTS = 3;

export const BEST_DIMENSIONS: { id: BestAccountDimension; label: string }[] = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'claude', label: 'Claude' },
];

export function shortBucketWindow(bucket: QuotaBucket): string {
  const raw = (bucket.window || bucket.displayName || bucket.bucketId || '').toLowerCase();
  if (raw.includes('week') || raw.includes('7d')) return '周限';
  if (raw.includes('five hour') || raw.includes('5 hour') || raw.includes('5h')) return '5h';
  return bucket.displayName || bucket.window || '窗口';
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

interface BestAntigravitySwitchBarProps {
  accounts: AccountDisplay[];
  layoutIdPrefix?: string;
}

export const BestAntigravitySwitchBar: React.FC<BestAntigravitySwitchBarProps> = ({
  accounts,
  layoutIdPrefix = 'overview-best-dim',
}) => {
  const { switchingIds, switchAccount } = useAccountStore();
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);
  const bestDimension = useOverviewPrefsStore((s) => s.bestDimension);
  const setBestDimension = useOverviewPrefsStore((s) => s.setBestDimension);
  const quotaDisplayMode = useOverviewPrefsStore((s) => s.quotaDisplayMode);
  const maskAccount = useOverviewPrefsStore((s) => s.maskAccount);

  const bestSelection = useMemo(
    () => pickBestAntigravityAccount(accounts, bestDimension),
    [accounts, bestDimension]
  );

  const candidate = bestSelection.bestSwitchCandidate;
  const candidateSwitching = Boolean(candidate && switchingIds[candidate.account.id]);
  const anySwitching = Object.values(switchingIds).some(Boolean);
  const hasBetterCandidate = bestSelection.hasBetterCandidate;
  const candidateTier = candidate ? candidate.account.subscriptionTier || 'FREE' : '';
  const dimLabel = BEST_DIMENSIONS.find((d) => d.id === bestDimension)?.label ?? 'Gemini';

  const formatShortAccount = (email: string) => {
    const shown = maskAccount ? maskAccountIdentity(email) : email;
    const at = shown.indexOf('@');
    return at > 0 ? shown.slice(0, at) : shown;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="inline-flex items-center rounded-lg border border-neutral-200/90 bg-card p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
        {BEST_DIMENSIONS.map((dim) => {
          const active = bestDimension === dim.id;
          return (
            <button
              key={dim.id}
              type="button"
              onClick={() => setBestDimension(dim.id)}
              className={`relative rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                active
                  ? 'text-white dark:text-neutral-900'
                  : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
              }`}
            >
              {active && (
                <motion.span
                  layoutId={shouldAnimate ? `${layoutIdPrefix}-pill` : undefined}
                  transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute inset-0 rounded-md bg-neutral-900 dark:bg-neutral-100"
                />
              )}
              <span className="relative z-10">{dim.label}</span>
            </button>
          );
        })}
      </div>

      {hasBetterCandidate && candidate ? (
        <button
          type="button"
          onClick={() => void switchAccount(candidate.account.id)}
          disabled={anySwitching}
          title={`一键切换到 ${maskAccount ? maskAccountIdentity(candidate.account.email) : candidate.account.email} (${candidateTier})`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white shadow-2xs transition-colors hover:bg-neutral-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {candidateSwitching ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          ) : (
            <Zap className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">
            {candidateSwitching
              ? '正在切换...'
              : `一键切至 ${formatShortAccount(candidate.account.email)} (${candidateTier} · ${
                  formatQuotaByMode(candidate.score, quotaDisplayMode).shortValue
                })`}
          </span>
        </button>
      ) : bestSelection.isCurrentAlreadyBest ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3 shrink-0" />
          <span>
            当前已为{dimLabel}最优 (
            {formatQuotaByMode(bestSelection.currentScore, quotaDisplayMode).label})
          </span>
        </span>
      ) : (
        <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
          暂无更优可切账号
        </span>
      )}
    </div>
  );
};

interface ProviderBentoCardProps {
  nowMs: number;
  singleProviderLayout: boolean;
}

export const AntigravityProviderCard: React.FC<ProviderBentoCardProps> = ({
  nowMs,
  singleProviderLayout,
}) => {
  const navigate = useNavigate();
  const resetTimeFormat = useResetTimeStore((s) => s.resetTimeFormat);
  const quotaDisplayMode = useOverviewPrefsStore((s) => s.quotaDisplayMode);
  const maskAccount = useOverviewPrefsStore((s) => s.maskAccount);
  const bestDimension = useOverviewPrefsStore((s) => s.bestDimension);

  const {
    accounts,
    refreshingAll,
    refreshingIds,
    switchingIds,
    refreshAccountQuota,
    refreshAllQuotas,
    switchAccount,
  } = useAccountStore();

  const [expanded, setExpanded] = useState(false);

  const sortedAccounts = useMemo(
    () => sortAntigravityAccounts(accounts, bestDimension, { pinCurrent: true }),
    [accounts, bestDimension]
  );

  const groupAggregates = useMemo(() => aggregateAntigravityGroups(accounts), [accounts]);
  const currentAccount = useMemo(() => accounts.find((a) => a.isCurrent) ?? null, [accounts]);

  if (accounts.length === 0) return null;

  const hiddenCount = Math.max(0, sortedAccounts.length - DEFAULT_VISIBLE_ACCOUNTS);
  const visibleAccounts = expanded
    ? sortedAccounts
    : sortedAccounts.slice(0, DEFAULT_VISIBLE_ACCOUNTS);
  const anySwitching = Object.values(switchingIds).some(Boolean);

  return (
    <section className="break-inside-avoid rounded-2xl border border-neutral-200/85 bg-card p-4 shadow-xs dark:border-neutral-800/90 dark:bg-neutral-900/90">
      {/* Provider Header */}
      <div className="flex items-center justify-between gap-2 pb-3">
        <button
          type="button"
          onClick={() => navigate('/quota/antigravity')}
          className="group inline-flex min-w-0 items-center gap-2 text-left"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900">
            <ShieldCheck className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight text-neutral-900 group-hover:underline dark:text-neutral-100">
            Antigravity
          </span>
          <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {accounts.length}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <span>{expanded ? '收起账号' : `展开其余 ${hiddenCount} 个账号`}</span>
              {expanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => void refreshAllQuotas()}
            disabled={refreshingAll}
            title="刷新全部 Antigravity 账号"
            aria-label="刷新全部 Antigravity 账号"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <RefreshCw className={`h-3 w-3 ${refreshingAll ? 'animate-spin' : ''}`} />
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

      {/* Multi-Account Aggregate + One-Click Best Switch Box */}
      {accounts.length >= 2 && (
        <div className="mb-3 rounded-xl border border-neutral-200/75 bg-neutral-50/75 p-3 dark:border-neutral-800/80 dark:bg-neutral-950/60">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">
              全部 {accounts.length} 个账号
            </span>
            {currentAccount ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                当前：
                <span className="max-w-[160px] truncate font-medium">
                  {maskAccount ? maskAccountIdentity(currentAccount.email) : currentAccount.email}
                </span>
              </span>
            ) : (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                当前客户端账号未匹配
              </span>
            )}
          </div>

          {groupAggregates.length > 0 && (
            <div className="mt-2.5 grid grid-cols-2 gap-x-3.5 gap-y-2">
              {groupAggregates.map((agg) => {
                const formatted = formatQuotaByMode(agg.avgRemainingPct, quotaDisplayMode);
                return (
                  <div key={agg.name} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-1.5 text-[11px]">
                      <span className="truncate font-medium text-neutral-600 dark:text-neutral-400">
                        {agg.name} 均值
                      </span>
                      <span
                        className={`shrink-0 font-mono text-[11px] font-semibold tabular-nums ${getQuotaTextColor(
                          formatted.remainingPct
                        )}`}
                      >
                        {formatted.label}
                      </span>
                    </div>
                    <ThinQuotaBar
                      barPct={formatted.barPct}
                      remainingPct={formatted.remainingPct}
                      ariaLabel={`${agg.name} 均值 ${formatted.label}`}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-2.5 border-t border-neutral-200/70 pt-2.5 dark:border-neutral-800/80">
            <BestAntigravitySwitchBar accounts={accounts} layoutIdPrefix="bento-ag-best" />
          </div>
        </div>
      )}

      {/* Account Sub-Cards */}
      <div
        className={
          singleProviderLayout
            ? 'grid grid-cols-1 gap-2.5 lg:grid-cols-2'
            : 'space-y-2.5'
        }
      >
        {visibleAccounts.map((acc) => {
          const isRefreshing = Boolean(refreshingIds[acc.id]);
          const isSwitching = Boolean(switchingIds[acc.id]);
          const displayEmail = maskAccount ? maskAccountIdentity(acc.email) : acc.email;
          const tier = acc.subscriptionTier || 'FREE';

          // Flatten groups -> compact 2-column metric cells (filtered by active Gemini/Claude tab when multi-account)
          const allGroups = acc.groups || [];
          const filterByDimension = accounts.length >= 2;
          const visibleGroups = filterByDimension
            ? allGroups.filter((g) =>
                (g.displayName || '').toLowerCase().includes(bestDimension)
              )
            : allGroups;

          const metricCells: {
            key: string;
            label: string;
            remainingPct: number;
            resetTime?: string;
          }[] = [];

          for (const group of visibleGroups) {
            const buckets = group.buckets || [];
            if (buckets.length === 0) continue;
            if (buckets.length === 1) {
              metricCells.push({
                key: `${group.displayName}-0`,
                label: group.displayName || '模型组',
                remainingPct: Math.round(buckets[0].remainingFraction * 100),
                resetTime: buckets[0].resetTime,
              });
            } else {
              buckets.forEach((b, idx) => {
                metricCells.push({
                  key: `${group.displayName}-${idx}`,
                  label: `${group.displayName || '模型组'} · ${shortBucketWindow(b)}`,
                  remainingPct: Math.round(b.remainingFraction * 100),
                  resetTime: b.resetTime,
                });
              });
            }
          }

          return (
            <div
              key={acc.id}
              className={`flex flex-col rounded-xl border p-3 transition-colors ${
                acc.isCurrent
                  ? 'border-emerald-500/60 bg-emerald-50/25 dark:border-emerald-500/45 dark:bg-emerald-950/15'
                  : 'border-neutral-200/75 bg-neutral-50/45 hover:border-neutral-300/90 dark:border-neutral-800/80 dark:bg-neutral-950/45 dark:hover:border-neutral-700/80'
              }`}
            >
              {/* Account Header Line */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100"
                    title={maskAccount ? undefined : acc.email}
                  >
                    {displayEmail}
                  </span>
                  {acc.isCurrent && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      使用中
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <span className="rounded bg-neutral-200/70 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    {tier}
                  </span>
                  {!acc.isCurrent && !acc.isForbidden && (
                    <button
                      type="button"
                      onClick={() => void switchAccount(acc.id)}
                      disabled={anySwitching || isRefreshing}
                      title="切换到此账号"
                      className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-card px-1.5 py-0.5 text-[10px] font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-45 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                    >
                      {isSwitching ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <ArrowRightLeft className="h-2.5 w-2.5" />
                      )}
                      <span>切换</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void refreshAccountQuota(acc.id)}
                    disabled={isRefreshing || isSwitching}
                    title="刷新额度"
                    aria-label={`刷新 ${displayEmail} 额度`}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  >
                    <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* 2-Column Compact Quota Grid */}
              {metricCells.length > 0 ? (
                <div
                  className={`mt-2.5 grid gap-x-3.5 gap-y-2.5 ${
                    metricCells.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                  }`}
                >
                  {metricCells.map((cell) => {
                    const formatted = formatQuotaByMode(cell.remainingPct, quotaDisplayMode);
                    return (
                      <div key={cell.key} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-1 text-[11px]">
                          <span className="truncate font-medium text-neutral-600 dark:text-neutral-300">
                            {cell.label}
                          </span>
                          <span
                            className={`shrink-0 font-mono text-[11px] font-semibold tabular-nums ${getQuotaTextColor(
                              formatted.remainingPct
                            )}`}
                          >
                            {formatted.label}
                          </span>
                        </div>
                        <ThinQuotaBar
                          barPct={formatted.barPct}
                          remainingPct={formatted.remainingPct}
                          ariaLabel={`${cell.label} ${formatted.label}`}
                        />
                        {cell.resetTime && (
                          <div className="truncate text-[10px] text-neutral-400 dark:text-neutral-500">
                            <ResetTimeText
                              resetTime={cell.resetTime}
                              format={resetTimeFormat}
                              nowMs={nowMs}
                              absoluteStyle="prefix"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : filterByDimension && allGroups.length > 0 ? (
                <p className="mt-2.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                  暂无 {bestDimension === 'claude' ? 'Claude' : 'Gemini'} 配额数据
                </p>
              ) : (
                <div className="mt-2.5 space-y-1">
                  {(() => {
                    const formatted = formatQuotaByMode(
                      acc.remainingPercentage,
                      quotaDisplayMode
                    );
                    return (
                      <>
                        <div className="flex items-baseline justify-between text-[11px]">
                          <span className="text-neutral-500 dark:text-neutral-400">综合额度</span>
                          <span
                            className={`font-mono font-semibold tabular-nums ${getQuotaTextColor(
                              formatted.remainingPct
                            )}`}
                          >
                            {formatted.label}
                          </span>
                        </div>
                        <ThinQuotaBar
                          barPct={formatted.barPct}
                          remainingPct={formatted.remainingPct}
                        />
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Error Alert */}
              {acc.errorMessage && (
                <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-rose-200/80 bg-rose-50/80 px-2.5 py-1.5 text-[11px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/35 dark:text-rose-300">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="line-clamp-2 leading-snug">{acc.errorMessage}</span>
                </div>
              )}

              {/* Micro Footer */}
              <div className="mt-2.5 flex items-center justify-between border-t border-neutral-200/60 pt-2 text-[10px] text-neutral-400 dark:border-neutral-800/70 dark:text-neutral-500">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {formatRelativeTime(acc.lastRefreshedAt, nowMs)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

function getQianwenDisplayName(acc: QianwenAccountDisplay, maskAccount: boolean): string {
  const raw = acc.name || acc.email || acc.aliyunId || '千问账号';
  return maskAccount ? maskAccountIdentity(raw) : raw;
}

function aggregateQianwenPrimaryPct(accounts: QianwenAccountDisplay[]): {
  avgPct: number;
  activePlanCount: number;
  expiredCount: number;
} {
  let sum = 0;
  let valid = 0;
  let activePlanCount = 0;
  let expiredCount = 0;

  for (const acc of accounts) {
    const q = acc.quota;
    if (q?.authExpired) {
      expiredCount += 1;
      continue;
    }
    const personal = q?.personal;
    const team = q?.team;
    const hasPersonal = personal?.status === 'active';
    const hasTeam = team?.status === 'active';
    if (hasPersonal || hasTeam) activePlanCount += 1;

    const pcts: number[] = [];
    if (hasPersonal && personal?.cycles?.length) {
      for (const c of personal.cycles) pcts.push(Math.round(c.remainingPercentage));
    }
    if (hasTeam && team && team.totalCredits > 0) {
      pcts.push(Math.round(team.remainingPercentage));
    }
    if (pcts.length > 0) {
      sum += Math.min(...pcts);
      valid += 1;
    }
  }

  return {
    avgPct: valid > 0 ? Math.round(sum / valid) : -1,
    activePlanCount,
    expiredCount,
  };
}

export const QianwenProviderCard: React.FC<ProviderBentoCardProps> = ({
  nowMs,
  singleProviderLayout,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const resetTimeFormat = useResetTimeStore((s) => s.resetTimeFormat);
  const quotaDisplayMode = useOverviewPrefsStore((s) => s.quotaDisplayMode);
  const maskAccount = useOverviewPrefsStore((s) => s.maskAccount);

  const {
    accounts,
    refreshingAll,
    refreshingIds,
    refreshAccount,
    refreshAllAccounts,
  } = useQianwenStore();

  const [expanded, setExpanded] = useState(false);

  const summary = useMemo(() => aggregateQianwenPrimaryPct(accounts), [accounts]);

  if (accounts.length === 0) return null;

  const hiddenCount = Math.max(0, accounts.length - DEFAULT_VISIBLE_ACCOUNTS);
  const visibleAccounts = expanded ? accounts : accounts.slice(0, DEFAULT_VISIBLE_ACCOUNTS);
  const summaryMetric = formatQuotaByMode(summary.avgPct, quotaDisplayMode);

  return (
    <section className="break-inside-avoid rounded-2xl border border-neutral-200/85 bg-card p-4 shadow-xs dark:border-neutral-800/90 dark:bg-neutral-900/90">
      {/* Provider Header */}
      <div className="flex items-center justify-between gap-2 pb-3">
        <button
          type="button"
          onClick={() => navigate('/quota/qianwen')}
          className="group inline-flex min-w-0 items-center gap-2 text-left"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white dark:bg-indigo-500">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight text-neutral-900 group-hover:underline dark:text-neutral-100">
            千问 · Token Plan
          </span>
          <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
            {accounts.length}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <span>{expanded ? '收起账号' : `展开其余 ${hiddenCount} 个账号`}</span>
              {expanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => void refreshAllAccounts()}
            disabled={refreshingAll}
            title="刷新全部千问账号"
            aria-label="刷新全部千问账号"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <RefreshCw className={`h-3 w-3 ${refreshingAll ? 'animate-spin' : ''}`} />
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

      {/* Multi-Account Aggregate Box */}
      {accounts.length >= 2 && (
        <div className="mb-3 rounded-xl border border-neutral-200/75 bg-neutral-50/75 p-3 dark:border-neutral-800/80 dark:bg-neutral-950/60">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">
              全部 {accounts.length} 个账号
            </span>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-neutral-500 dark:text-neutral-400">
                有效订阅 {summary.activePlanCount}
              </span>
              {summary.expiredCount > 0 && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
                  {summary.expiredCount} 个过期
                </span>
              )}
            </div>
          </div>

          <div className="mt-2 space-y-1">
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-neutral-500 dark:text-neutral-400">综合平均额度</span>
              <span
                className={`font-mono font-semibold tabular-nums ${getQuotaTextColor(
                  summaryMetric.remainingPct
                )}`}
              >
                {summaryMetric.label}
              </span>
            </div>
            <ThinQuotaBar
              barPct={summaryMetric.barPct}
              remainingPct={summaryMetric.remainingPct}
              ariaLabel={`千问综合平均额度 ${summaryMetric.label}`}
            />
          </div>
        </div>
      )}

      {/* Account Sub-Cards */}
      <div
        className={
          singleProviderLayout
            ? 'grid grid-cols-1 gap-2.5 lg:grid-cols-2'
            : 'space-y-2.5'
        }
      >
        {visibleAccounts.map((acc) => {
          const isRefreshing = Boolean(refreshingIds[acc.id]);
          const quota = acc.quota;
          const personal = quota?.personal;
          const team = quota?.team;
          const hasPersonal = personal?.status === 'active';
          const hasTeam = team?.status === 'active';
          const displayName = getQianwenDisplayName(acc, maskAccount);
          const rawName = acc.name || acc.email || acc.aliyunId || '千问账号';
          const tierLabel = hasPersonal
            ? personal?.planName || personal?.specCode || '个人版'
            : hasTeam
              ? team?.planName || '团队版'
              : '未订阅';

          return (
            <div
              key={acc.id}
              className="flex flex-col rounded-xl border border-neutral-200/75 bg-neutral-50/45 p-3 transition-colors hover:border-neutral-300/90 dark:border-neutral-800/80 dark:bg-neutral-950/45 dark:hover:border-neutral-700/80"
            >
              {/* Account Header */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className="truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100"
                  title={maskAccount ? undefined : rawName}
                >
                  {displayName}
                </span>

                <div className="flex shrink-0 items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                      hasPersonal || hasTeam
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300'
                        : 'bg-neutral-200/70 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                    }`}
                  >
                    {tierLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshAccount(acc.id)}
                    disabled={isRefreshing}
                    title="刷新千问额度"
                    aria-label={`刷新 ${displayName} 额度`}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-800 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  >
                    <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Body */}
              {quota?.authExpired ? (
                <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-amber-200/90 bg-amber-50/80 px-2.5 py-2 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">授权已过期，请在设置中重新授权</span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      openSettingsModal(navigate, location, 'providers', {
                        provider: 'qianwen',
                        action: 'reauth',
                        qianwenAccountId: acc.id,
                      })
                    }
                    className="shrink-0 rounded-md bg-amber-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-neutral-950 dark:hover:bg-amber-400"
                  >
                    重新授权
                  </button>
                </div>
              ) : hasPersonal && personal?.cycles?.length ? (
                <div className="mt-2.5 space-y-2">
                  <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5">
                    {personal.cycles.map((cycle) => {
                      const formatted = formatQuotaByMode(
                        Math.round(cycle.remainingPercentage),
                        quotaDisplayMode
                      );
                      return (
                        <div key={cycle.cycle} className="space-y-1">
                          <div className="flex items-baseline justify-between gap-1 text-[11px]">
                            <span className="truncate font-medium text-neutral-600 dark:text-neutral-300">
                              {cycle.label || cycle.cycle}
                            </span>
                            <span
                              className={`shrink-0 font-mono text-[11px] font-semibold tabular-nums ${getQuotaTextColor(
                                formatted.remainingPct
                              )}`}
                            >
                              {formatted.label}
                            </span>
                          </div>
                          <ThinQuotaBar
                            barPct={formatted.barPct}
                            remainingPct={formatted.remainingPct}
                            ariaLabel={`${cycle.label || cycle.cycle} ${formatted.label}`}
                          />
                          {cycle.resetTime && (
                            <div className="truncate text-[10px] text-neutral-400 dark:text-neutral-500">
                              <ResetTimeText
                                resetTime={cycle.resetTime}
                                format={resetTimeFormat}
                                nowMs={nowMs}
                                absoluteStyle="prefix"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {personal.endTime && (
                    <div className="flex items-center gap-1 text-[10px] text-neutral-400 dark:text-neutral-500">
                      <CalendarClock className="h-2.5 w-2.5 shrink-0" />
                      <span>
                        到期 {formatDateOnly(personal.endTime)}（剩 {personal.remainingDays} 天）
                      </span>
                    </div>
                  )}
                </div>
              ) : hasTeam && team && team.totalCredits > 0 ? (
                <div className="mt-2.5 space-y-1.5">
                  {(() => {
                    const formatted = formatQuotaByMode(
                      Math.round(team.remainingPercentage),
                      quotaDisplayMode
                    );
                    const usedCredits = Math.max(0, team.totalCredits - team.remainingCredits);
                    return (
                      <>
                        <div className="flex items-baseline justify-between gap-2 text-[11px]">
                          <span className="truncate font-medium text-neutral-600 dark:text-neutral-300">
                            团队 Credits ({quotaDisplayMode === 'used' ? usedCredits : team.remainingCredits} / {team.totalCredits})
                          </span>
                          <span
                            className={`shrink-0 font-mono font-semibold tabular-nums ${getQuotaTextColor(
                              formatted.remainingPct
                            )}`}
                          >
                            {formatted.label}
                          </span>
                        </div>
                        <ThinQuotaBar
                          barPct={formatted.barPct}
                          remainingPct={formatted.remainingPct}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-neutral-400 dark:text-neutral-500">
                          {team.resetTime ? (
                            <ResetTimeText
                              resetTime={team.resetTime}
                              format={resetTimeFormat}
                              nowMs={nowMs}
                              absoluteStyle="prefix"
                            />
                          ) : (
                            <span>{team.endTime ? `到期 ${formatDateOnly(team.endTime)}` : ''}</span>
                          )}
                          {team.addonRemaining > 0 && (
                            <span>加量包余 {team.addonRemaining}</span>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <p className="mt-2.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                  暂无有效 Token Plan 订阅
                </p>
              )}

              {quota?.errorMessage && !quota?.authExpired && (
                <div className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-rose-200/80 bg-rose-50/80 px-2.5 py-1.5 text-[11px] text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/35 dark:text-rose-300">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="line-clamp-2 break-all leading-snug">
                    {quota.errorMessage}
                  </span>
                </div>
              )}

              {/* Micro Footer */}
              <div className="mt-2.5 flex items-center justify-between border-t border-neutral-200/60 pt-2 text-[10px] text-neutral-400 dark:border-neutral-800/70 dark:text-neutral-500">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {formatRelativeTime(quota?.lastRefreshedAt, nowMs)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
