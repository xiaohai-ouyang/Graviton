import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  Check,
  Copy,
  Pencil,
  Play,
  RotateCw,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useEnvStore } from '../store/useEnvStore';
import { useAccountStore } from '../store/useAccountStore';
import { ProcessState, ProjectCommand, ProjectRecord } from '../types';

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
    startCommand,
    stopCommand,
    restartCommand,
    clearLogs,
  } = useEnvStore();

  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
  const badge = getStatusBadge(procState);

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
      <div className="flex flex-1 flex-col items-center justify-center bg-white px-6 text-center text-neutral-500 dark:bg-[#0d1117] dark:text-neutral-400">
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
    <section className="relative flex min-w-0 flex-1 flex-col bg-white text-neutral-900 dark:bg-[#0d1117] dark:text-neutral-100">
      {/* Terminal Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50/90 px-4 py-3 dark:border-neutral-800 dark:bg-[#161b22]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${badge.dot}`} />
            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {project.name}
            </span>
            <span className="text-neutral-400 dark:text-neutral-600">/</span>
            <span className="truncate text-sm font-medium text-neutral-600 dark:text-neutral-300">
              {command.name}
            </span>
            <span
              className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium ${badge.pill}`}
            >
              {badge.label}
            </span>
          </div>

          <div className="mt-1 flex items-center gap-2 font-mono text-xs text-neutral-500 dark:text-neutral-400">
            <span className="truncate">
              $ {command.command}
              {command.cwd ? `  (in ${command.cwd})` : ''}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {isRunning ? (
            <>
              <button
                type="button"
                onClick={() => void restartCommand(project.id, command.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <RotateCw className="h-3.5 w-3.5" />
                <span>重启</span>
              </button>
              <button
                type="button"
                onClick={() => void stopCommand(command.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-500"
              >
                <Square className="h-3 w-3 fill-current" />
                <span>停止</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void startCommand(project.id, command.id)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>启动</span>
            </button>
          )}

          <div className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-800" />

          <button
            type="button"
            onClick={() => void handleCopy()}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              copied
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
            }`}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? '已复制' : '一键复制'}</span>
          </button>

          <button
            type="button"
            onClick={() => void clearLogs(command.id)}
            title="清空输出"
            className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>清空</span>
          </button>

          <button
            type="button"
            onClick={() => onEditCommand(project.id, command)}
            title="编辑此指令"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:border-neutral-800 dark:bg-transparent dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
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
            {logs.map((entry, idx) => {
              const colorClass =
                entry.stream === 'stderr'
                  ? 'text-rose-600 dark:text-rose-400'
                  : entry.stream === 'system'
                  ? 'text-sky-600 dark:text-sky-400/90'
                  : 'text-neutral-800 dark:text-neutral-200';
              return (
                <div key={idx} className={`whitespace-pre-wrap break-all ${colorClass}`}>
                  {entry.line}
                </div>
              );
            })}
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
