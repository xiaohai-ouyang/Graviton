import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion } from 'motion/react';
import { useAccountStore } from '../store/useAccountStore';
import { useMotionStore } from '../store/useMotionStore';
import { AlertTriangle } from 'lucide-react';

export const DeleteConfirmModal: React.FC = () => {
  const { deletingAccount, cancelDeleteAccount, executeDeleteAccount } = useAccountStore();
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  const open = Boolean(deletingAccount);

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && cancelDeleteAccount()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={shouldAnimate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={shouldAnimate ? { duration: 0.14 } : { duration: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs"
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
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-card p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                确认删除此账号记录？
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                即将删除账号 <strong className="font-semibold text-neutral-800 dark:text-neutral-200">{deletingAccount?.email}</strong> 的收录记录及其独立凭据。
                <br /><br />
                <span className="text-neutral-500 dark:text-neutral-400">
                  注意：此操作作用范围仅为 <strong>Graviton 本地记录</strong>，绝不会影响 Antigravity 客户端中当前正在使用的登录状态。
                </span>
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2.5">
            <button
              onClick={cancelDeleteAccount}
              className="rounded-lg border border-neutral-200 bg-card px-3.5 py-2 text-xs font-medium text-neutral-700 shadow-xs hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              取消
            </button>
            <button
              onClick={executeDeleteAccount}
              className="rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-medium text-white shadow-xs hover:bg-rose-700 active:scale-[0.98] dark:bg-rose-700 dark:hover:bg-rose-600"
            >
              确认删除
            </button>
          </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
