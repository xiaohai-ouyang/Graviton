import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  ArrowDown,
  Check,
  Copy,
  ExternalLink,
  Pencil,
  Play,
  RotateCw,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useEnvStore } from '../store/useEnvStore';
import { useAccountStore } from '../store/useAccountStore';
import { LogEntry, ProcessState, ProjectCommand, ProjectRecord } from '../types';
import {
  SHELL_META,
  normalizeDefaultShell,
  resolveEffectiveShell,
} from '../utils/shell';

// Progressive label-collapse thresholds based on TerminalPane's own width,
// with hysteresis bands so dragging the split divider never flickers.
const SECONDARY_LABEL_HIDE_WIDTH = 492;
const SECONDARY_LABEL_SHOW_WIDTH = 512;
const SECONDARY_LABEL_INIT_WIDTH = 502;

const PRIMARY_LABEL_HIDE_WIDTH = 382;
const PRIMARY_LABEL_SHOW_WIDTH = 402;
const PRIMARY_LABEL_INIT_WIDTH = 392;

interface AdaptiveActionButtonProps {
  icon: React.ReactNode;
  label: string;
  tooltip?: string;
  showLabel: boolean;
  onClick: () => void;
  toneClass: string;
  expandedPaddingClass: string;
  compactPaddingClass: string;
}

const AdaptiveActionButton: React.FC<AdaptiveActionButtonProps> = ({
  icon,
  label,
  tooltip,
  showLabel,
  onClick,
  toneClass,
  expandedPaddingClass,
  compactPaddingClass,
}) => {
  const tipText = tooltip ?? label;

  return (
    <Tooltip.Root open={showLabel ? false : undefined}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={tipText}
          className={`inline-flex h-7 shrink-0 items-center justify-center rounded-lg text-xs font-medium transition-[padding,background-color,border-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            showLabel ? expandedPaddingClass : compactPaddingClass
          } ${toneClass}`}
        >
          <span className="inline-flex shrink-0 items-center justify-center">{icon}</span>
          <span
            aria-hidden={!showLabel}
            className={`inline-grid overflow-hidden transition-[grid-template-columns,opacity,margin] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              showLabel
                ? 'ml-1.5 grid-cols-[1fr] opacity-100'
                : 'ml-0 grid-cols-[0fr] opacity-0'
            }`}
          >
            <span className="min-w-0 overflow-hidden whitespace-nowrap">{label}</span>
          </span>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          align="center"
          sideOffset={6}
          className="z-[70] rounded-lg border border-neutral-200/20 bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-neutral-100 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
        >
          {tipText}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};

const STDERR_WARN_RE = /\b(warn|warning|deprecated)\b|警告/i;
const STDERR_ERROR_RE =
  /\b(error|err|fatal|critical|exception|traceback|panic|failed|errno)\b|^\s*File ".*", line \d+|\w+(Error|Exception):|exited with code [1-9]|已退出\s*\(code=[1-9]|错误|异常|失败/i;
const STDERR_INFO_RE =
  /\b(INFO|DEBUG)\b|^\s*\*\s+(Serving|Debug mode|Running on|Restarting|Debugger)|Press CTRL\+C to quit|\b(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+\S+\s+HTTP\//i;

const getLogLineColorClass = (entry: LogEntry): string => {
  if (entry.stream === 'system') {
    if (entry.line.includes('状态: error')) {
      return 'text-rose-600 dark:text-rose-400';
    }
    return 'text-sky-600 dark:text-sky-400/90';
  }
  if (entry.stream === 'stderr') {
    const line = entry.line;
    if (STDERR_WARN_RE.test(line) && !/^\s*(error|fatal|critical)\b/i.test(line)) {
      return 'text-amber-600 dark:text-amber-400';
    }
    if (STDERR_INFO_RE.test(line) && !STDERR_ERROR_RE.test(line)) {
      return 'text-neutral-800 dark:text-neutral-200';
    }
    if (STDERR_ERROR_RE.test(line)) {
      return 'text-rose-600 dark:text-rose-400';
    }
    // Many runtimes (Python logging, Flask, Uvicorn, git, npm) emit normal status lines on stderr.
    return 'text-neutral-800 dark:text-neutral-200';
  }
  return 'text-neutral-800 dark:text-neutral-200';
};

interface TerminalPaneProps {
  onEditCommand: (projectId: string, cmd: ProjectCommand) => void;
}

const getStatusBadge = (state?: ProcessState) => {
  const status = state?.status;
  if (status === 'running') {
    return {
      label: state?.pid ? `运行中 · PID ${state.pid}` : '运行中',
      dot: 'bg-emerald-500 dark:bg-emerald-400 animate-pulse',
      pill: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300',
    };
  }
  if (status === 'error') {
    return {
      label: state?.exitCode !== undefined ? `异常退出 (${state.exitCode})` : '异常退出',
      dot: 'bg-rose-500 dark:bg-rose-400',
      pill: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300',
    };
  }
  return {
    label: '未运行',
    dot: 'bg-neutral-400 dark:bg-neutral-500',
    pill: 'border-neutral-200 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400',
  };
};

export const TerminalPane: React.FC<TerminalPaneProps> = ({ onEditCommand }) => {
  const {
    projects,
    activeLogTarget,
    logsByCmd,
    processStates,
    portOverview,
    shellEnv,
    startCommand,
    stopCommand,
    restartCommand,
    clearLogs,
    openLocalURL,
  } = useEnvStore();

  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [paneEl, setPaneEl] = useState<HTMLElement | null>(null);
  const [labelVisibility, setLabelVisibility] = useState<{
    primary: boolean;
    secondary: boolean;
  }>({
    primary: true,
    secondary: true,
  });
  const initializedWidthRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!paneEl) return;

    const updateForWidth = (width: number) => {
      if (width <= 0) return;

      if (!initializedWidthRef.current) {
        initializedWidthRef.current = true;
        setLabelVisibility({
          primary: width >= PRIMARY_LABEL_INIT_WIDTH,
          secondary: width >= SECONDARY_LABEL_INIT_WIDTH,
        });
        return;
      }

      setLabelVisibility((prev) => {
        let nextPrimary = prev.primary;
        if (prev.primary && width < PRIMARY_LABEL_HIDE_WIDTH) {
          nextPrimary = false;
        } else if (!prev.primary && width >= PRIMARY_LABEL_SHOW_WIDTH) {
          nextPrimary = true;
        }

        let nextSecondary = prev.secondary;
        if (prev.secondary && width < SECONDARY_LABEL_HIDE_WIDTH) {
          nextSecondary = false;
        } else if (!prev.secondary && width >= SECONDARY_LABEL_SHOW_WIDTH) {
          nextSecondary = true;
        }

        if (nextPrimary === prev.primary && nextSecondary === prev.secondary) {
          return prev;
        }
        return { primary: nextPrimary, secondary: nextSecondary };
      });
    };

    updateForWidth(paneEl.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateForWidth(entry.contentRect.width);
    });
    observer.observe(paneEl);

    return () => {
      observer.disconnect();
      initializedWidthRef.current = false;
    };
  }, [paneEl]);

  const { project, command } = useMemo<{
    project: ProjectRecord | null;
    command: ProjectCommand | null;
  }>(() => {
    if (!activeLogTarget) return { project: null, command: null };
    const p = projects.find((item) => item.id === activeLogTarget.projectId) ?? null;
    const c = p?.commands.find((item) => item.id === activeLogTarget.commandId) ?? null;
    return { project: p, command: c };
  }, [projects, activeLogTarget]);

  const logs = useMemo(
    () => (command ? logsByCmd[command.id] || [] : []),
    [command, logsByCmd]
  );

  const procState = command ? processStates[command.id] : undefined;
  const isRunning = procState?.status === 'running';
  const livePorts = isRunning && procState?.ports ? procState.ports : [];
  const cmdOverviewEntries = command
    ? portOverview?.entries?.filter((e) => e.commandId === command.id) ?? []
    : [];
  const cmdExternalClash = cmdOverviewEntries.find((e) => e.externalClash)?.externalClash;
  const cmdStaticClash = cmdOverviewEntries.some((e) => e.staticClash);
  const badge = getStatusBadge(procState);
  const defaultShell = normalizeDefaultShell(shellEnv?.config.defaultShell);
  const effectiveShell = resolveEffectiveShell(command?.shell, defaultShell);
  const shellMeta = SHELL_META[effectiveShell];
  const commandLines = useMemo(
    () => (command ? command.command.split(/\r?\n/) : []),
    [command]
  );
  const commandPreview = command
    ? commandLines.length > 1
      ? `${commandLines[0]} … (+${commandLines.length - 1} 行)`
      : command.command
    : '';

  useEffect(() => {
    setAutoScroll(true);
    setCopied(false);
  }, [command?.id]);

  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [logs, autoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 36;
    setAutoScroll(atBottom);
  };

  const scrollToBottom = () => {
    if (!containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
    setAutoScroll(true);
  };

  const handleCopy = async () => {
    if (!logs.length) {
      useAccountStore.getState().setBanner({ type: 'info', message: '当前没有可复制的终端输出' });
      return;
    }
    const text = logs.map((l) => l.line).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      useAccountStore.getState().setBanner({
        type: 'success',
        message: `已复制 ${logs.length} 行终端输出`,
      });
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      useAccountStore.getState().setBanner({ type: 'error', message: '复制失败，请检查剪贴板权限' });
    }
  };

  if (!project || !command) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center bg-white px-6 text-center text-neutral-500 dark:bg-[#0d1117] dark:text-neutral-400">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-[#161b22]">
          <Terminal className="h-5 w-5 text-neutral-400 dark:text-neutral-500" />
        </div>
        <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">终端输出面板</p>
        <p className="mt-1 text-xs text-neutral-500">
          在左侧选择一个指令或直接点击「启动」，即可在此查看实时输出并一键复制
        </p>
      </div>
    );
  }

  return (
    <section
      ref={setPaneEl}
      className="relative flex min-w-0 flex-1 flex-col bg-white text-neutral-900 dark:bg-[#0d1117] dark:text-neutral-100"
    >
      {/* Terminal Header */}
      <div className="flex flex-nowrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50/90 px-4 py-3 dark:border-neutral-800 dark:bg-[#161b22]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${badge.dot}`} />
            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {project.name}
            </span>
            <span className="shrink-0 text-neutral-400 dark:text-neutral-600">/</span>
            <span className="truncate text-sm font-medium text-neutral-600 dark:text-neutral-300">
              {command.name}
            </span>
            <span
              className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${badge.pill}`}
            >
              {badge.label}
            </span>
            {livePorts.length > 0 ? (
              <div className="flex shrink-0 items-center gap-1">
                {livePorts.slice(0, 2).map((lp) => {
                  const localUrl = lp.url || `http://localhost:${lp.port}`;
                  return (
                    <Tooltip.Root key={`${lp.port}-${lp.pid}`}>
                      <Tooltip.Trigger asChild>
                        <button
                          type="button"
                          onClick={() => void openLocalURL(localUrl)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
                        >
                          <span>:{lp.port}</span>
                          <ExternalLink className="h-2.5 w-2.5 opacity-75" />
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content
                          side="bottom"
                          align="start"
                          sideOffset={6}
                          className="z-[70] rounded-lg border border-neutral-200/20 bg-neutral-900 px-2.5 py-1 text-[11px] font-mono text-neutral-100 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
                        >
                          打开 {localUrl}
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  );
                })}
                {livePorts.length > 2 && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <span className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                        +{livePorts.length - 2}
                      </span>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        side="bottom"
                        align="start"
                        sideOffset={6}
                        className="z-[70] whitespace-pre-wrap rounded-lg border border-neutral-200/20 bg-neutral-900 px-2.5 py-1.5 font-mono text-[11px] text-neutral-100 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
                      >
                        {livePorts
                          .slice(2)
                          .map((p) => p.url || `http://localhost:${p.port}`)
                          .join('\n')}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                )}
              </div>
            ) : command.expectedPort && command.expectedPort > 0 ? (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span
                    className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium ${
                      cmdExternalClash
                        ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300'
                        : cmdStaticClash
                        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
                        : 'border-neutral-200 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400'
                    }`}
                  >
                    :{command.expectedPort}
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    className="z-[70] rounded-lg border border-neutral-200/20 bg-neutral-900 px-2.5 py-1 text-[11px] text-neutral-100 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
                  >
                    {cmdExternalClash
                      ? `端口 :${command.expectedPort} 已被 ${cmdExternalClash.processName} (PID ${cmdExternalClash.pid}) 占用`
                      : cmdStaticClash
                      ? `预期端口 :${command.expectedPort}（与其他项目配置冲突）`
                      : `预期端口 :${command.expectedPort}`}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            ) : null}
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-xs text-neutral-500 dark:text-neutral-400">
            <span
              className={`shrink-0 rounded px-1 py-0.2 text-[10px] font-medium ${shellMeta.badgeClass}`}
            >
              {shellMeta.shortLabel}
            </span>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <span className="truncate">
                  {shellMeta.prompt} {commandPreview}
                  {command.cwd ? `  (in ${command.cwd})` : ''}
                </span>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="bottom"
                  align="start"
                  sideOffset={6}
                  className="z-[70] max-w-md whitespace-pre-wrap break-all rounded-lg border border-neutral-200/20 bg-neutral-900 px-2.5 py-1.5 font-mono text-[11px] text-neutral-100 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
                >
                  {command.command}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1.5">
          {isRunning ? (
            <>
              <AdaptiveActionButton
                icon={<RotateCw className="h-3.5 w-3.5" />}
                label="重启"
                showLabel={labelVisibility.primary}
                onClick={() => void restartCommand(project.id, command.id)}
                expandedPaddingClass="px-2.5"
                compactPaddingClass="px-1.5"
                toneClass="border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              />
              <AdaptiveActionButton
                icon={<Square className="h-3 w-3 fill-current" />}
                label="停止"
                showLabel={labelVisibility.primary}
                onClick={() => void stopCommand(command.id)}
                expandedPaddingClass="px-2.5"
                compactPaddingClass="px-2"
                toneClass="bg-rose-600 text-white hover:bg-rose-500"
              />
            </>
          ) : (
            <AdaptiveActionButton
              icon={<Play className="h-3 w-3 fill-current" />}
              label="启动"
              showLabel={labelVisibility.primary}
              onClick={() => void startCommand(project.id, command.id)}
              expandedPaddingClass="px-3"
              compactPaddingClass="px-2"
              toneClass="bg-emerald-600 text-white hover:bg-emerald-500"
            />
          )}

          <div className="mx-1 h-4 w-px shrink-0 bg-neutral-200 dark:bg-neutral-800" />

          <AdaptiveActionButton
            icon={copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            label={copied ? '已复制' : '一键复制'}
            tooltip={copied ? '已复制' : '一键复制'}
            showLabel={labelVisibility.secondary}
            onClick={() => void handleCopy()}
            expandedPaddingClass="px-2.5"
            compactPaddingClass="px-1.5"
            toneClass={`border ${
              copied
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
            }`}
          />

          <AdaptiveActionButton
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="清空"
            tooltip="清空输出"
            showLabel={labelVisibility.secondary}
            onClick={() => void clearLogs(command.id)}
            expandedPaddingClass="px-2.5"
            compactPaddingClass="px-1.5"
            toneClass="border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
          />

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                onClick={() => onEditCommand(project.id, command)}
                aria-label="编辑此指令"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:border-neutral-800 dark:bg-transparent dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                align="end"
                sideOffset={6}
                className="z-[70] rounded-lg border border-neutral-200/20 bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-neutral-100 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
              >
                编辑此指令
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
      </div>

      {/* Terminal Output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs leading-6 select-text"
      >
        {logs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-neutral-400 dark:text-neutral-500">
            <p>暂无终端输出</p>
            <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-600">
              点击上方或左侧「启动」运行指令，输出将实时显示在此处
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {logs.map((entry, idx) => (
              <div
                key={idx}
                className={`whitespace-pre-wrap break-all ${getLogLineColorClass(entry)}`}
              >
                {entry.line}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scroll to bottom pill */}
      {!autoScroll && logs.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute right-5 bottom-4 inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-lg backdrop-blur-xs transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800/95 dark:text-neutral-200 dark:hover:bg-neutral-700"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          <span>回到底部</span>
        </button>
      )}
    </section>
  );
};
