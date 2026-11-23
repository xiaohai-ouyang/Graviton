import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, FileClock, Hourglass, PartyPopper, RotateCcw, X } from 'lucide-react';
import { useAppInfoStore } from '../store/useAppInfoStore';
import { useMotionStore } from '../store/useMotionStore';
import { useUpdateStore } from '../store/useUpdateStore';

export const UpdateStatusBar: React.FC = () => {
  const state = useUpdateStore((s) => s.state);
  const restartToApply = useUpdateStore((s) => s.restartToApply);
  const cancelDeferred = useUpdateStore((s) => s.cancelDeferred);
  const dismissUpdatedNotice = useUpdateStore((s) => s.dismissUpdatedNotice);
  const setModalOpen = useUpdateStore((s) => s.setModalOpen);
  const openChangelog = useAppInfoStore((s) => s.openChangelog);
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  const waiting = state?.status === 'waiting_idle';
  const installed = state?.status === 'installed';
  const updated = Boolean(state?.updatedFromVersion);
  const visible = waiting || installed || updated;

  const bannerKey = waiting ? 'waiting-idle' : installed ? 'installed-pending-restart' : 'updated-notice';

  return (
    <AnimatePresence initial={false}>
      {visible && state && (
        <motion.div
          key={bannerKey}
          initial={shouldAnimate ? { height: 0, opacity: 0 } : false}
          animate={{ height: 'auto', opacity: 1 }}
          exit={shouldAnimate ? { height: 0, opacity: 0 } : { opacity: 0 }}
          transition={
            shouldAnimate
              ? { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
              : { duration: 0 }
          }
          className="overflow-hidden"
        >
          {waiting ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-amber-200/80 bg-amber-50 px-5 py-2.5 text-xs text-amber-800 dark:border-amber-800/70 dark:bg-amber-950/50 dark:text-amber-200">
              <Hourglass className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                v{state.latestVersion} 已安装完成，将在当前任务与托管进程全部结束后自动重启应用
                {state.busyReasons && state.busyReasons.length > 0 && (
                  <span className="text-amber-700/80 dark:text-amber-300/80">
                    （{state.busyReasons.join('；')}）
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/60"
              >
                查看详情
              </button>
              <button
                type="button"
                onClick={() => void cancelDeferred()}
                className="shrink-0 rounded-md border border-amber-300/80 px-2 py-1 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/60"
              >
                取消预约
              </button>
            </div>
          ) : installed ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-emerald-200/80 bg-emerald-50 px-5 py-2.5 text-xs text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                Graviton v{state.latestVersion} 已安装完成，重启应用后即可生效
              </span>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
              >
                查看详情
              </button>
              <button
                type="button"
                onClick={() => void restartToApply()}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-emerald-800 dark:bg-emerald-500 dark:text-neutral-950 dark:hover:bg-emerald-400"
              >
                <RotateCcw className="h-3 w-3" />
                立即重启
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-b border-emerald-200/80 bg-emerald-50 px-5 py-2.5 text-xs text-emerald-800 dark:border-emerald-800/70 dark:bg-emerald-950/50 dark:text-emerald-200">
              <PartyPopper className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                Graviton 已成功更新至 v{state.currentVersion}
              </span>
              <button
                type="button"
                onClick={() => {
                  openChangelog();
                  void dismissUpdatedNotice();
                }}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
              >
                <FileClock className="h-3 w-3" />
                查看更新日志
              </button>
              <button
                type="button"
                aria-label="关闭更新提示"
                onClick={() => void dismissUpdatedNotice()}
                className="shrink-0 rounded-md p-1 text-emerald-700 transition-colors hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
