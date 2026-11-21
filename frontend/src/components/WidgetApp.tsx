import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccountDisplay, QuotaGroup } from '../types';
import { api } from '../services/api';
import { useNowTick } from '../hooks/useNowTick';
import {
  formatRelativeTime,
  formatResetDisplay,
  getGroupEffectivePct,
  getQuotaBarColor,
  getQuotaTextColor,
  ResetTimeFormat,
} from '../utils/quota';
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  Lock,
  RefreshCw,
  Sparkles,
  Unlock,
  X,
} from 'lucide-react';

interface WidgetStateSnapshot {
  accounts: AccountDisplay[];
  theme: 'light' | 'dark';
  refreshingAll: boolean;
  refreshingIds: Record<string, boolean>;
  switchingIds: Record<string, boolean>;
  lastUpdated: string;
  widgetLocked: boolean;
  widgetAlwaysOnTop?: boolean;
  resetTimeFormat?: ResetTimeFormat;
}

const WIDGET_WIDTH = 340;

function findGroup(account: AccountDisplay, keyword: string): QuotaGroup | undefined {
  const lower = keyword.toLowerCase();
  return (account.groups || []).find((g) => (g.displayName || '').toLowerCase().includes(lower));
}

function getBucketSummary(group?: QuotaGroup): {
  fiveHourPct: number | null;
  fiveHourReset?: string;
  weeklyPct: number | null;
  weeklyReset?: string;
} {
  if (!group || !group.buckets || group.buckets.length === 0) {
    return { fiveHourPct: null, weeklyPct: null };
  }
  let fiveHourPct: number | null = null;
  let fiveHourReset: string | undefined;
  let weeklyPct: number | null = null;
  let weeklyReset: string | undefined;

  for (const b of group.buckets) {
    const lbl = (b.window || b.displayName || '').toLowerCase();
    const pct = Math.round(b.remainingFraction * 100);
    if (lbl.includes('weekly')) {
      weeklyPct = pct;
      weeklyReset = b.resetTime;
    } else if (lbl.includes('5') || lbl.includes('five')) {
      fiveHourPct = pct;
      fiveHourReset = b.resetTime;
    }
  }
  if (fiveHourPct === null && weeklyPct === null && group.buckets[0]) {
    fiveHourPct = Math.round(group.buckets[0].remainingFraction * 100);
    fiveHourReset = group.buckets[0].resetTime;
  }
  return { fiveHourPct, fiveHourReset, weeklyPct, weeklyReset };
}

export const WidgetApp: React.FC = () => {
  const [conn, setConn] = useState<{ port: number; token: string } | null>(null);
  const [state, setState] = useState<WidgetStateSnapshot>({
    accounts: [],
    theme: 'light',
    refreshingAll: false,
    refreshingIds: {},
    switchingIds: {},
    lastUpdated: '',
    widgetLocked: false,
  });
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const nowMs = useNowTick();
  const resetTimeFormat: ResetTimeFormat =
    state.resetTimeFormat === 'absolute' ? 'absolute' : 'countdown';

  const contentRef = useRef<HTMLDivElement | null>(null);

  // Add widget-mode class for transparent WebView2 background
  useEffect(() => {
    document.documentElement.classList.add('widget-mode');
    return () => document.documentElement.classList.remove('widget-mode');
  }, []);

  // Apply synced theme
  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
  }, [state.theme]);

  // Apply synced always-on-top setting
  useEffect(() => {
    if (typeof state.widgetAlwaysOnTop === 'boolean') {
      void api.applyWidgetAlwaysOnTop(state.widgetAlwaysOnTop);
    }
  }, [state.widgetAlwaysOnTop]);

  // Connect to main process IPC + SSE
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;

    const init = async () => {
      const c = await api.getWidgetConnection();
      if (cancelled || !c.port) return;
      setConn({ port: c.port, token: c.token });

      es = new EventSource(`http://127.0.0.1:${c.port}/api/events?token=${encodeURIComponent(c.token)}`);
      es.addEventListener('state', (evt) => {
        try {
          const parsed = JSON.parse((evt as MessageEvent).data) as WidgetStateSnapshot;
          setState(parsed);
        } catch {
          // Ignore malformed SSE frame
        }
      });
    };

    void init();
    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  const currentAccount = useMemo(
    () => state.accounts.find((a) => a.isCurrent) ?? null,
    [state.accounts]
  );

  const remainingAccounts = useMemo(
    () => state.accounts.filter((a) => !a.isCurrent),
    [state.accounts]
  );

  // Dynamically fit window height to actual rendered content
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const syncSize = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) {
        void api.setWidgetSize(WIDGET_WIDTH, Math.min(480, h));
      }
    };

    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded, state.accounts.length, currentAccount?.id, actionError]);

  const postAction = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
      if (!conn) return;
      setActionError(null);
      try {
        const res = await fetch(`http://127.0.0.1:${conn.port}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${conn.token}`,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.error) setActionError(data.error);
        }
      } catch (e) {
        setActionError(String(e));
      }
    },
    [conn]
  );

  // Persist window position after dragging stops
  const handleDragEnd = useCallback(async () => {
    try {
      const bounds = await api.getWidgetWindowBounds();
      if (!bounds.width) return;
      await postAction('/api/widget-pos', { x: bounds.x, y: bounds.y });
    } catch {
      // Ignore bounds check errors
    }
  }, [postAction]);

  const isCurrentRefreshing = currentAccount
    ? Boolean(state.refreshingIds[currentAccount.id]) || state.refreshingAll
    : state.refreshingAll;

  return (
    <div className="w-screen opacity-95 transition-opacity duration-200 hover:opacity-100">
      <div
        ref={contentRef}
        className="flex w-full flex-col overflow-hidden bg-white/80 text-neutral-900 backdrop-blur-xl dark:bg-neutral-900/75 dark:text-neutral-100"
      >
        {/* Draggable Header */}
        <div
          onMouseUp={state.widgetLocked ? undefined : () => void handleDragEnd()}
          style={
            {
              '--wails-draggable': state.widgetLocked ? 'no-drag' : 'drag',
            } as React.CSSProperties
          }
          className="flex items-center justify-between border-b border-neutral-200/70 px-3 py-2 dark:border-neutral-800/80"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-semibold tracking-tight">
              {currentAccount ? currentAccount.email : '未检测到当前账号'}
            </span>
            {currentAccount?.subscriptionTier && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                <Sparkles className="h-2.5 w-2.5 text-amber-500" />
                {currentAccount.subscriptionTier}
              </span>
            )}
          </div>

          <div
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
            className="flex shrink-0 items-center gap-1"
          >
            <button
              onClick={() => void postAction('/api/refresh', { id: currentAccount?.id || '' })}
              disabled={isCurrentRefreshing || !currentAccount}
              title="刷新当前账号额度"
              className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isCurrentRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => void postAction('/api/widget-lock', { locked: !state.widgetLocked })}
              title={state.widgetLocked ? '解锁悬浮窗' : '锁定悬浮窗'}
              className={`rounded-md p-1 transition-colors ${
                state.widgetLocked
                  ? 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:bg-amber-500/20 dark:text-amber-400'
                  : 'text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
              }`}
            >
              {state.widgetLocked ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <Unlock className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              onClick={() => void postAction('/api/close-widget')}
              title="关闭悬浮窗"
              className="rounded-md p-1 text-neutral-500 transition-colors hover:bg-rose-100 hover:text-rose-600 dark:text-neutral-400 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Current Account Summary Card */}
        <div className="px-3 py-2.5">
          {currentAccount ? (
            <div className="space-y-2">
              {(['gemini', 'claude'] as const).map((key) => {
                const label = key === 'gemini' ? 'Gemini' : 'Claude';
                const pct = getGroupEffectivePct(currentAccount, key);
                const group = findGroup(currentAccount, key);
                const summary = getBucketSummary(group);
                const isUnknown = pct < 0;
                const fiveHourDisplay =
                  summary.fiveHourPct !== null
                    ? formatResetDisplay(summary.fiveHourReset, resetTimeFormat, {
                        nowMs,
                        compact: true,
                        absoluteStyle: 'bare',
                      })
                    : null;
                const weeklyDisplay =
                  summary.weeklyPct !== null
                    ? formatResetDisplay(summary.weeklyReset, resetTimeFormat, {
                        nowMs,
                        compact: true,
                        absoluteStyle: 'bare',
                      })
                    : null;

                return (
                  <div
                    key={key}
                    className="rounded-xl bg-neutral-100/70 px-2.5 py-1.5 dark:bg-neutral-800/60"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-neutral-700 dark:text-neutral-200">
                        {label}
                      </span>
                      <span className={`font-bold tabular-nums ${getQuotaTextColor(pct)}`}>
                        {isUnknown ? '未知' : `${pct}%`}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isUnknown ? 'w-0' : getQuotaBarColor(pct)
                        }`}
                        style={{ width: isUnknown ? '0%' : `${Math.max(0, Math.min(100, pct))}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-neutral-500 dark:text-neutral-400">
                      <span
                        className="inline-flex items-center gap-1"
                        title={fiveHourDisplay?.tooltip}
                      >
                        <Clock className="h-2.5 w-2.5" />
                        5h:{' '}
                        {summary.fiveHourPct !== null && fiveHourDisplay
                          ? `${summary.fiveHourPct}% (${fiveHourDisplay.text})`
                          : '未知'}
                      </span>
                      <span title={weeklyDisplay?.tooltip}>
                        Weekly:{' '}
                        {summary.weeklyPct !== null && weeklyDisplay
                          ? `${summary.weeklyPct}% (${weeklyDisplay.text})`
                          : '未知'}
                      </span>
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-between pt-0.5 text-[10px] text-neutral-400 dark:text-neutral-500">
                <span>上次刷新: {formatRelativeTime(currentAccount.lastRefreshedAt, nowMs)}</span>
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-neutral-600 transition-colors hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  <span>
                    {expanded
                      ? '收起列表'
                      : `展开其余账号 (${remainingAccounts.length})`}
                  </span>
                  {expanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                暂未识别到当前使用的账号
              </p>
              <button
                onClick={() => void postAction('/api/open-main')}
                className="mt-2 rounded-lg bg-neutral-900 px-3 py-1.5 text-[11px] font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                打开主窗口收录账号
              </button>
            </div>
          )}

          {actionError && (
            <p className="mt-1 truncate text-[10px] text-rose-500">{actionError}</p>
          )}
        </div>

        {/* Expanded Remaining Accounts */}
        {expanded && (
          <div className="flex flex-col border-t border-neutral-200/70 dark:border-neutral-800/80">
            <div className="max-h-[220px] space-y-1.5 overflow-y-auto px-3 py-2">
              {remainingAccounts.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-neutral-400">
                  暂无其他已收录账号
                </p>
              ) : (
                remainingAccounts.map((acc) => {
                  const gemPct = getGroupEffectivePct(acc, 'gemini');
                  const claPct = getGroupEffectivePct(acc, 'claude');
                  const isRef = Boolean(state.refreshingIds[acc.id]) || state.refreshingAll;
                  const isSw = Boolean(state.switchingIds[acc.id]);

                  return (
                    <div
                      key={acc.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200/70 bg-white/60 px-2.5 py-2 dark:border-neutral-800 dark:bg-neutral-800/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[11px] font-medium text-neutral-800 dark:text-neutral-200">
                            {acc.email}
                          </span>
                          {acc.subscriptionTier && (
                            <span className="shrink-0 rounded bg-neutral-200/70 px-1 py-0.2 text-[9px] font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                              {acc.subscriptionTier}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-[10px] tabular-nums">
                          <span>
                            Gemini:{' '}
                            <strong className={getQuotaTextColor(gemPct)}>
                              {gemPct < 0 ? '未知' : `${gemPct}%`}
                            </strong>
                          </span>
                          <span>
                            Claude:{' '}
                            <strong className={getQuotaTextColor(claPct)}>
                              {claPct < 0 ? '未知' : `${claPct}%`}
                            </strong>
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => void postAction('/api/refresh', { id: acc.id })}
                          disabled={isRef || isSw}
                          title="刷新该账号"
                          className="rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                        >
                          <RefreshCw className={`h-3 w-3 ${isRef ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={() => void postAction('/api/switch', { id: acc.id })}
                          disabled={isSw || isRef}
                          title="切换到此账号"
                          className="inline-flex items-center gap-1 rounded-md bg-neutral-900 px-2 py-1 text-[10px] font-medium text-white transition-colors hover:bg-neutral-700 disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                        >
                          <ArrowRightLeft className="h-2.5 w-2.5" />
                          <span>{isSw ? '切换中' : '切换'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between border-t border-neutral-200/70 px-3 py-1.5 text-[10px] dark:border-neutral-800/80">
              <span className="text-neutral-400">
                共 {state.accounts.length} 个账号
              </span>
              <button
                onClick={() => void postAction('/api/refresh', { id: 'all' })}
                disabled={state.refreshingAll}
                className="inline-flex items-center gap-1 font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-40 dark:text-neutral-300 dark:hover:text-neutral-100"
              >
                <RefreshCw className={`h-3 w-3 ${state.refreshingAll ? 'animate-spin' : ''}`} />
                <span>{state.refreshingAll ? '刷新中...' : '刷新全部'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
