import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { useDeepSeekStore } from '../store/useDeepSeekStore';
import { useMotionStore } from '../store/useMotionStore';

export const DeepSeekDeleteConfirmModal: React.FC = () => {
  const { deletingAccount, cancelDeleteAccount, executeDeleteAccount } = useDeepSeekStore();
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  const open = Boolean(deletingAccount);
  const label =
    deletingAccount?.name || deletingAccount?.keyPreview || deletingAccount?.id;

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && cancelDeleteAccount()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={shouldAnimate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={shouldAnimate ? { duration: 0.14 } : { duration: 0 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-xs"
          />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <motion.div
            initial={shouldAnimate ? { opacity: 0, scale: 0.96, y: 4 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={
              shouldAnimate
                ? { duration: 0.15, ease: [0.22, 1, 0.36, 1] }
                : { duration: 0 }
            }
            className="fixed left-1/2 top-1/2 z-[60] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-card p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  确认移除 DeepSeek 账号？
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                  即将移除 DeepSeek 账号{' '}
                  <strong className="font-semibold text-neutral-800 dark:text-neutral-200">
                    {label}
                  </strong>{' '}
                  的本地记录，并删除 Windows 凭据管理器中保存的 API Key。
                </Dialog.Description>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={cancelDeleteAccount}
                className="rounded-lg border border-neutral-200 bg-card px-3.5 py-2 text-xs font-medium text-neutral-700 shadow-xs hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                取消
              </button>
              <button
                type="button"
                onClick={executeDeleteAccount}
                className="rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-medium text-white shadow-xs hover:bg-rose-700 active:scale-[0.98] dark:bg-rose-700 dark:hover:bg-rose-600"
              >
                确认移除
              </button>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
