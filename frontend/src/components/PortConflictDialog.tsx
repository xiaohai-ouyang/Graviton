import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEnvStore } from '../store/useEnvStore';
import { useMotionStore } from '../store/useMotionStore';

export const PortConflictDialog: React.FC = () => {
  const {
    portConflictDialog,
    closePortConflictDialog,
    confirmStartWithOverridePort,
    confirmStopConflictAndStart,
  } = useEnvStore();
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  const [newPortInput, setNewPortInput] = useState('');
  const [submittingAction, setSubmittingAction] = useState<'override' | 'stop' | null>(null);

  const open = Boolean(portConflictDialog?.open);
  const check = portConflictDialog?.check;
  const conflictPort = check?.port ?? 0;
  const occupant = check?.occupant;

  useEffect(() => {
    if (!open || !check) return;
    setNewPortInput(check.suggestedPort ? String(check.suggestedPort) : '');
    setSubmittingAction(null);
  }, [open, check]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && !submittingAction) {
        e.preventDefault();
        closePortConflictDialog();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, submittingAction, closePortConflictDialog]);

  const parsedNewPort = Number(newPortInput.trim());
  const isNewPortValid =
    newPortInput.trim() !== '' &&
    Number.isInteger(parsedNewPort) &&
    parsedNewPort >= 1 &&
    parsedNewPort <= 65535 &&
    parsedNewPort !== conflictPort;

  const occupantLabel = occupant
    ? occupant.isManaged
      ? `Graviton · ${occupant.projectName || '未命名项目'} / ${occupant.commandName || '指令'}`
      : `外部进程 · ${occupant.processName || '未知进程'} (PID ${occupant.pid})`
    : '未知进程';

  const handleStartWithOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isNewPortValid || submittingAction) return;
    setSubmittingAction('override');
    const ok = await confirmStartWithOverridePort(parsedNewPort);
    if (!ok) {
      setSubmittingAction(null);
    }
  };

  const handleStopAndStart = async () => {
    if (submittingAction) return;
    setSubmittingAction('stop');
    const ok = await confirmStopConflictAndStart();
    if (!ok) {
      setSubmittingAction(null);
    }
  };

  return (
    <AnimatePresence>
      {open && portConflictDialog && (
        <motion.div
          initial={shouldAnimate ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={shouldAnimate ? { duration: 0.14 } : { duration: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label="端口冲突处理"
            initial={shouldAnimate ? { opacity: 0, scale: 0.96, y: 4 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={shouldAnimate ? { opacity: 0, scale: 0.96, y: 4 } : { opacity: 0 }}
            transition={
              shouldAnimate
                ? { duration: 0.15, ease: [0.22, 1, 0.36, 1] }
                : { duration: 0 }
            }
            className="w-full max-w-md rounded-2xl border border-neutral-200 bg-card p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  端口 :{conflictPort} 已被占用
                </h3>
              </div>
              <button
                type="button"
                disabled={Boolean(submittingAction)}
                onClick={closePortConflictDialog}
                aria-label="关闭"
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3.5 space-y-2 rounded-xl border border-neutral-200/80 bg-neutral-50/80 px-3 py-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-950/60">
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-neutral-500 dark:text-neutral-400">准备启动</span>
                <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                  {portConflictDialog.projectName} / {portConflictDialog.commandName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-neutral-500 dark:text-neutral-400">当前占用</span>
                <span className="truncate font-mono text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  {occupantLabel}
                </span>
              </div>
            </div>

            <form onSubmit={handleStartWithOverride} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  临时换用端口（仅本次生效）
                </label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  disabled={Boolean(submittingAction)}
                  value={newPortInput}
                  onChange={(e) => setNewPortInput(e.target.value)}
                  placeholder="输入可用端口号"
                  className={`mt-1.5 w-full rounded-lg border bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-900 focus:outline-hidden dark:bg-neutral-800 dark:text-neutral-100 ${
                    isNewPortValid
                      ? 'border-neutral-200 focus:border-neutral-400 dark:border-neutral-700'
                      : 'border-rose-400 focus:border-rose-500 dark:border-rose-500'
                  }`}
                />
                {!isNewPortValid && newPortInput.trim() !== '' && (
                  <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                    请输入 1~65535 之间且不同于 :{conflictPort} 的端口
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={Boolean(submittingAction)}
                  onClick={closePortConflictDialog}
                  className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={Boolean(submittingAction)}
                  onClick={() => void handleStopAndStart()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300 dark:hover:bg-rose-500/25"
                >
                  {submittingAction === 'stop' && <Loader2 className="h-3 w-3 animate-spin" />}
                  <span>停止占用并启动</span>
                </button>
                <button
                  type="submit"
                  disabled={!isNewPortValid || Boolean(submittingAction)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  {submittingAction === 'override' && <Loader2 className="h-3 w-3 animate-spin" />}
                  <span>换端口启动</span>
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
