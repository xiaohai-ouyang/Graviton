import React, { useEffect, useMemo, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Network,
  Play,
  RefreshCw,
  Square,
  Terminal,
  XCircle,
} from 'lucide-react';
import { useEnvStore } from '../store/useEnvStore';
import { useAccountStore } from '../store/useAccountStore';
import { ProjectPortEntry } from '../types';
import { TOOLTIP_CONTENT_CLASS } from './IconSegmentedControl';

type PortFilter = 'all' | 'running' | 'conflict';

export const PortOverviewPane: React.FC = () => {
  const {
    portOverview,
    portOverviewLoading,
    refreshPortOverview,
    startCommand,
    stopCommand,
    openLogDrawer,
    killExternalPortProcess,
    openLocalURL,
  } = useEnvStore();

  const [filter, setFilter] = useState<PortFilter>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmKillPid, setConfirmKillPid] = useState<number | null>(null);

  useEffect(() => {
    void refreshPortOverview();
    const timer = window.setInterval(() => {
      void refreshPortOverview();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refreshPortOverview]);

  const entries = portOverview?.entries ?? [];

  const filteredEntries = useMemo(() => {
    return entries.filter((item) => {
      if (filter === 'running') return item.state === 'running';
      if (filter === 'conflict') return item.staticClash || Boolean(item.externalClash);
      return true;
    });
  }, [entries, filter]);

  const handleCopyURL = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      useAccountStore.getState().setBanner({ type: 'success', message: `已复制 ${url}` });
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1600);
    } catch {
      useAccountStore.getState().setBanner({ type: 'error', message: '复制失败，请检查剪贴板权限' });
    }
  };

  const renderEntryRow = (entry: ProjectPortEntry, idx: number) => {
    const rowKey = `${entry.commandId}-${entry.port}-${idx}`;
    const isRunning = entry.state === 'running';
    const hasExternal = Boolean(entry.externalClash);
    const hasConflict = entry.staticClash || hasExternal;
    const isCopied = copiedKey === rowKey;
    const localUrl = entry.url || `http://localhost:${entry.port}`;
    const isConfirmingKill = hasExternal && confirmKillPid === entry.externalClash?.pid;

    const portBadgeClass = hasExternal
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-300'
      : entry.staticClash
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-300'
      : isRunning
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-300'
      : 'border-neutral-200 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';

    return (
      <div
        key={rowKey}
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
          hasExternal
            ? 'border-rose-200/80 bg-rose-50/30 dark:border-rose-500/25 dark:bg-rose-950/15'
            : entry.staticClash
            ? 'border-amber-200/80 bg-amber-50/25 dark:border-amber-500/25 dark:bg-amber-950/10'
            : 'border-neutral-200/80 bg-card hover:bg-neutral-50/70 dark:border-neutral-800 dark:bg-neutral-900/70 dark:hover:bg-neutral-900'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* Port Number */}
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 font-mono text-xs font-semibold ${portBadgeClass}`}
          >
            {hasConflict && <AlertTriangle className="h-3 w-3 shrink-0" />}
            <span>:{entry.port}</span>
          </span>

          {/* Project / Command & Status */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void openLogDrawer(entry.projectId, entry.commandId)}
                className="truncate text-left text-xs font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
              >
                {entry.projectName}
              </button>
              <span className="text-neutral-400 dark:text-neutral-600">/</span>
              <button
                type="button"
                onClick={() => void openLogDrawer(entry.projectId, entry.commandId)}
                className="truncate text-left text-xs font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
              >
                {entry.commandName}
              </button>
              {entry.cwd && (
                <span className="shrink-0 rounded bg-neutral-200/70 px-1.5 py-0.2 font-mono text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  {entry.cwd}
                </span>
              )}
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              {isRunning ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>监听中</span>
                  {entry.processName && (
                    <span className="font-mono text-neutral-500 dark:text-neutral-400">
                      · {entry.processName}
                    </span>
                  )}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-600" />
                  <span>配置端口</span>
                </span>
              )}

              {entry.overridePort &&
                entry.overridePort > 0 &&
                entry.expectedPort &&
                entry.expectedPort > 0 &&
                entry.overridePort !== entry.expectedPort && (
                  <span className="rounded bg-neutral-100 px-1.5 py-0.2 font-mono text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    原 :{entry.expectedPort}
                  </span>
                )}

              {entry.staticClash && (
                <span className="rounded bg-amber-100/80 px-1.5 py-0.2 font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                  同端口冲突
                </span>
              )}

              {entry.externalClash && (
                <span className="rounded bg-rose-100/90 px-1.5 py-0.2 font-mono text-[10px] font-medium text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                  外部占用 · {entry.externalClash.processName} (PID {entry.externalClash.pid})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Row Actions */}
        <div className="flex shrink-0 items-center gap-1">
          {hasExternal && entry.externalClash && (
            isConfirmingKill ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const pid = entry.externalClash!.pid;
                    setConfirmKillPid(null);
                    void killExternalPortProcess(pid);
                  }}
                  className="inline-flex h-7 items-center rounded-lg bg-rose-600 px-2 text-[11px] font-medium text-white transition-colors hover:bg-rose-500"
                >
                  确认终止
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmKillPid(null)}
                  className="inline-flex h-7 items-center rounded-lg border border-neutral-200 px-2 text-[11px] font-medium text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  取消
                </button>
              </div>
            ) : (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    onClick={() => setConfirmKillPid(entry.externalClash!.pid)}
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 text-[11px] font-medium text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300 dark:hover:bg-rose-500/25"
                  >
                    <XCircle className="h-3 w-3" />
                    <span>释放</span>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="top" sideOffset={6} className={TOOLTIP_CONTENT_CLASS}>
                    终止外部进程 {entry.externalClash.processName} (PID {entry.externalClash.pid})
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            )
          )}

          {isRunning ? (
            <>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    onClick={() => void openLocalURL(localUrl)}
                    aria-label={`打开 ${localUrl}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="top" sideOffset={6} className={TOOLTIP_CONTENT_CLASS}>
                    在浏览器打开 {localUrl}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    onClick={() => void handleCopyURL(rowKey, localUrl)}
                    aria-label={`复制 ${localUrl}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  >
                    {isCopied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="top" sideOffset={6} className={TOOLTIP_CONTENT_CLASS}>
                    {isCopied ? '已复制' : `复制 ${localUrl}`}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    onClick={() => void openLogDrawer(entry.projectId, entry.commandId)}
                    aria-label="查看终端"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                  >
                    <Terminal className="h-3.5 w-3.5" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="top" sideOffset={6} className={TOOLTIP_CONTENT_CLASS}>
                    查看终端输出
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>

              <button
                type="button"
                onClick={() => void stopCommand(entry.commandId)}
                className="inline-flex h-7 items-center gap-1 rounded-lg bg-rose-600 px-2 text-[11px] font-medium text-white transition-colors hover:bg-rose-500"
              >
                <Square className="h-2.5 w-2.5 fill-current" />
                <span>停止</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void startCommand(entry.projectId, entry.commandId)}
              className="inline-flex h-7 items-center gap-1 rounded-lg bg-neutral-900 px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <Play className="h-2.5 w-2.5 fill-current" />
              <span>启动</span>
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-white text-neutral-900 dark:bg-[#0d1117] dark:text-neutral-100">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50/90 px-4 py-3 dark:border-neutral-800 dark:bg-[#161b22]">
        <div className="inline-flex items-center rounded-lg border border-neutral-200/90 bg-neutral-100/80 p-0.5 dark:border-neutral-800 dark:bg-neutral-950/70">
          {(
            [
              { id: 'all', label: '全部' },
              { id: 'running', label: '运行中' },
              { id: 'conflict', label: '冲突' },
            ] as const
          ).map((tab) => {
            const active = filter === tab.id;
            const showAlertDot =
              tab.id === 'conflict' && (portOverview?.conflictCount ?? 0) > 0;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-card text-neutral-900 shadow-2xs dark:bg-neutral-800 dark:text-neutral-50'
                    : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                }`}
              >
                <span>{tab.label}</span>
                {showAlertDot && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
                )}
              </button>
            );
          })}
        </div>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type="button"
              onClick={() => void refreshPortOverview()}
              aria-label="刷新端口状态"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${portOverviewLoading ? 'animate-spin' : ''}`} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="bottom" align="end" sideOffset={6} className={TOOLTIP_CONTENT_CLASS}>
              刷新实时端口
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredEntries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-neutral-400 dark:text-neutral-500">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-[#161b22]">
              <Network className="h-5 w-5 text-neutral-400 dark:text-neutral-500" />
            </div>
            <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {filter === 'conflict'
                ? '当前没有端口冲突'
                : filter === 'running'
                ? '暂无运行中的监听端口'
                : '暂未识别到项目端口'}
            </p>
            {filter === 'all' && (
              <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                启动服务后会自动探测真实端口，或在指令编辑中手动补充预期端口
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">{filteredEntries.map(renderEntryRow)}</div>
        )}
      </div>
    </section>
  );
};
