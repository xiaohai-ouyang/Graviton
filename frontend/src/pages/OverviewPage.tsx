import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  LayoutGrid,
  Link2,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { motion } from 'motion/react';
import { QuotaProgressBar } from '../components/QuotaProgressBar';
import { ResetTimeText } from '../components/ResetTimeText';
import { useNowTick } from '../hooks/useNowTick';
import { useAccountStore } from '../store/useAccountStore';
import { useMotionStore } from '../store/useMotionStore';
import { useQianwenStore } from '../store/useQianwenStore';
import { useResetTimeStore } from '../store/useResetTimeStore';
import {
  formatBucketLabel,
  formatRelativeTime,
  getQuotaTextColor,
} from '../utils/quota';

type ProviderFilter = 'all' | 'antigravity' | 'qianwen';

export const OverviewPage: React.FC = () => {
  const navigate = useNavigate();
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);
  const resetTimeFormat = useResetTimeStore((s) => s.resetTimeFormat);
  const nowMs = useNowTick();

  const {
    accounts: agAccounts,
    loading: agLoading,
    refreshingAll: agRefreshingAll,
    refreshingIds: agRefreshingIds,
    refreshAccountQuota: refreshAgAccount,
    refreshAllQuotas: refreshAllAg,
  } = useAccountStore();

  const {
    accounts: qwAccounts,
    loading: qwLoading,
    refreshingAll: qwRefreshingAll,
    refreshingIds: qwRefreshingIds,
    refreshAccount: refreshQwAccount,
    refreshAllAccounts: refreshAllQw,
  } = useQianwenStore();

  const [filter, setFilter] = useState<ProviderFilter>('all');

  const sortedAgAccounts = useMemo(() => {
    return [...agAccounts].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
  }, [agAccounts]);

  const anyRefreshingAll = agRefreshingAll || qwRefreshingAll;
  const totalCount = agAccounts.length + qwAccounts.length;
  const isLoading = (agLoading || qwLoading) && totalCount === 0;

  const handleRefreshAllProviders = async () => {
    const tasks: Promise<unknown>[] = [];
    if (agAccounts.length > 0 && !agRefreshingAll) {
      tasks.push(refreshAllAg());
    }
    if (qwAccounts.length > 0 && !qwRefreshingAll) {
      tasks.push(refreshAllQw());
    }
    await Promise.all(tasks);
  };

  const showAg = filter === 'all' || filter === 'antigravity';
  const showQw = filter === 'all' || filter === 'qianwen';
  const visibleCount = (showAg ? sortedAgAccounts.length : 0) + (showQw ? qwAccounts.length : 0);

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-neutral-200/80 bg-card/80 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/80">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              概览
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              已接入 {agAccounts.length} 个 Antigravity 账号 · {qwAccounts.length} 个千问账号
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Provider Filter */}
            <div className="inline-flex rounded-lg border border-neutral-200/90 bg-card p-0.5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900">
              {(
                [
                  { id: 'all', label: `全部 (${totalCount})` },
                  { id: 'antigravity', label: `Antigravity (${agAccounts.length})` },
                  { id: 'qianwen', label: `千问 (${qwAccounts.length})` },
                ] as const
              ).map((opt) => {
                const active = filter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFilter(opt.id)}
                    className={`relative rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'text-white dark:text-neutral-900'
                        : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId={shouldAnimate ? 'overview-filter-pill' : undefined}
                        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                        className="inset-0 absolute rounded-md bg-neutral-900 shadow-2xs dark:bg-neutral-100"
                      />
                    )}
                    <span className="relative z-10">{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => void handleRefreshAllProviders()}
              disabled={anyRefreshingAll || totalCount === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-card px-3.5 py-2 text-xs font-medium text-neutral-700 shadow-xs transition-colors hover:bg-neutral-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${anyRefreshingAll ? 'animate-spin' : ''}`} />
              <span>{anyRefreshingAll ? '正在刷新全部...' : '刷新全部'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        {isLoading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-neutral-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-800 dark:border-neutral-700 dark:border-t-neutral-200" />
            <p className="text-xs">正在加载各供应商额度概览...</p>
          </div>
        ) : visibleCount === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-card/50 p-12 text-center dark:border-neutral-800 dark:bg-neutral-900/30">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              <LayoutGrid className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-base font-semibold text-neutral-800 dark:text-neutral-200">
              暂无已连接的供应商账号
            </h3>
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              在左侧「额度」下选择对应供应商连接账号后，这里将平铺展示全部模型与套餐额度状态。
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => navigate('/quota/antigravity')}
                className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white shadow-xs hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>管理 Antigravity 账号</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/quota/qianwen')}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-card px-4 py-2 text-xs font-medium text-neutral-700 shadow-xs hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>连接千问账号</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {/* Antigravity Compact Cards */}
            {showAg &&
              sortedAgAccounts.map((acc) => {
                const isRefreshing = Boolean(agRefreshingIds[acc.id]);
                const groups = acc.groups || [];
                const tier = acc.subscriptionTier || 'FREE';

                return (
                  <div
                    key={`ag-${acc.id}`}
                    className={`flex flex-col rounded-2xl border bg-card transition-all duration-150 dark:bg-neutral-900 ${
                      acc.isCurrent
                        ? 'border-emerald-500/80 ring-1 ring-emerald-500/30 shadow-sm dark:border-emerald-500/60 dark:ring-emerald-500/20'
                        : 'border-neutral-200/90 shadow-xs hover:border-neutral-300 dark:border-neutral-800 dark:hover:border-neutral-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800/80">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="shrink-0 rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
                            Antigravity
                          </span>
                          <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                            {tier}
                          </span>
                          {acc.isCurrent && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              使用中
                            </span>
                          )}
                        </div>
                        <p
                          className="mt-1.5 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100"
                          title={acc.email}
                        >
                          {acc.email}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => refreshAgAccount(acc.id)}
                        disabled={isRefreshing}
                        title="刷新额度"
                        aria-label={`刷新 ${acc.email} 额度`}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-600 shadow-2xs hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-300 dark:hover:bg-neutral-700"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => navigate('/quota/antigravity')}
                      className="flex flex-1 flex-col justify-between gap-2.5 rounded-b-2xl p-4 text-left transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-800/35"
                    >
                      {groups.length > 0 ? (
                        <div className="w-full space-y-2.5">
                          {groups.map((group, gIdx) => {
                            const primaryBucket = group.buckets?.[0];
                            const remPct = primaryBucket
                              ? Math.round(primaryBucket.remainingFraction * 100)
                              : -1;
                            return (
                              <div key={gIdx} className="space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                                    {group.displayName || '模型组'}
                                    {primaryBucket ? (
                                      <span className="ml-1 text-[10px] text-neutral-400">
                                        · {formatBucketLabel(primaryBucket.window || primaryBucket.displayName)}
                                      </span>
                                    ) : null}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {primaryBucket?.resetTime && (
                                      <ResetTimeText
                                        resetTime={primaryBucket.resetTime}
                                        format={resetTimeFormat}
                                        nowMs={nowMs}
                                        className="text-[10px] text-neutral-400 dark:text-neutral-500"
                                      />
                                    )}
                                    <span className={`font-semibold ${getQuotaTextColor(remPct)}`}>
                                      {remPct >= 0 ? `${remPct}%` : '未知'}
                                    </span>
                                  </div>
                                </div>
                                <QuotaProgressBar percentage={remPct} size="sm" />
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-neutral-400 dark:text-neutral-500">
                          {acc.errorMessage || '暂无模型额度快照'}
                        </p>
                      )}

                      <div className="mt-1 flex w-full items-center justify-between border-t border-neutral-100 pt-2 text-[11px] text-neutral-400 dark:border-neutral-800/80 dark:text-neutral-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {formatRelativeTime(acc.lastRefreshedAt, nowMs)}
                        </span>
                        <span className="inline-flex items-center gap-0.5 font-medium text-neutral-600 dark:text-neutral-300">
                          管理与切号
                          <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
                    </button>
                  </div>
                );
              })}

            {/* Qianwen Compact Cards */}
            {showQw &&
              qwAccounts.map((acc) => {
                const isRefreshing = Boolean(qwRefreshingIds[acc.id]);
                const quota = acc.quota;
                const personal = quota?.personal;
                const team = quota?.team;
                const hasPersonal = personal?.status === 'active';
                const hasTeam = team?.status === 'active';
                const displayName =
                  acc.name || acc.email || acc.aliyunId || '千问账号';
                const tierLabel = hasPersonal
                  ? personal?.planName || personal?.specCode || '个人版'
                  : hasTeam
                    ? team?.planName || '团队版'
                    : '未订阅';

                return (
                  <div
                    key={`qw-${acc.id}`}
                    className="flex flex-col rounded-2xl border border-neutral-200/90 bg-card shadow-xs transition-all duration-150 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
                  >
                    <div className="flex items-start justify-between gap-2 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800/80">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="shrink-0 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-indigo-500">
                            千问
                          </span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              hasPersonal || hasTeam
                                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                            }`}
                          >
                            {tierLabel}
                          </span>
                        </div>
                        <p
                          className="mt-1.5 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100"
                          title={displayName}
                        >
                          {displayName}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => refreshQwAccount(acc.id)}
                        disabled={isRefreshing}
                        title="刷新千问额度"
                        aria-label={`刷新 ${displayName} 额度`}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-600 shadow-2xs hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-300 dark:hover:bg-neutral-700"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => navigate('/quota/qianwen')}
                      className="flex flex-1 flex-col justify-between gap-2.5 rounded-b-2xl p-4 text-left transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-800/35"
                    >
                      {quota?.authExpired ? (
                        <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>登录已过期，点击进入千问页重新授权</span>
                        </div>
                      ) : hasPersonal && personal?.cycles?.length ? (
                        <div className="w-full space-y-2.5">
                          {personal.cycles.map((cycle) => {
                            const remPct = Math.round(cycle.remainingPercentage);
                            return (
                              <div key={cycle.cycle} className="space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                                    {cycle.label || cycle.cycle}
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
                                    <span className={`font-semibold ${getQuotaTextColor(remPct)}`}>
                                      剩 {remPct}%
                                    </span>
                                  </div>
                                </div>
                                <QuotaProgressBar percentage={remPct} size="sm" />
                              </div>
                            );
                          })}
                        </div>
                      ) : hasTeam && team && team.totalCredits > 0 ? (
                        <div className="w-full space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-medium text-neutral-700 dark:text-neutral-300">
                              团队 Credits
                            </span>
                            <span
                              className={`font-semibold ${getQuotaTextColor(
                                Math.round(team.remainingPercentage)
                              )}`}
                            >
                              剩 {Math.round(team.remainingPercentage)}%
                            </span>
                          </div>
                          <QuotaProgressBar
                            percentage={Math.round(team.remainingPercentage)}
                            size="sm"
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-neutral-400 dark:text-neutral-500">
                          {quota?.errorMessage || '暂无有效 Token Plan 订阅'}
                        </p>
                      )}

                      <div className="mt-1 flex w-full items-center justify-between border-t border-neutral-100 pt-2 text-[11px] text-neutral-400 dark:border-neutral-800/80 dark:text-neutral-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          {formatRelativeTime(quota?.lastRefreshedAt, nowMs)}
                        </span>
                        <span className="inline-flex items-center gap-0.5 font-medium text-neutral-600 dark:text-neutral-300">
                          查看详情
                          <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
                    </button>
                  </div>
                );
              })}
          </div>
        )}
      </main>
    </>
  );
};
