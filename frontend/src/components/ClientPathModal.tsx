import React, { useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAccountStore } from '../store/useAccountStore';
import { FolderOpen, X, MonitorCheck } from 'lucide-react';

interface ClientPathModalProps {
  open: boolean;
  onClose: () => void;
}

export const ClientPathModal: React.FC<ClientPathModalProps> = ({ open, onClose }) => {
  const { clientPath, loadClientPath, selectClientPath } = useAccountStore();

  useEffect(() => {
    if (open) {
      loadClientPath();
    }
  }, [open, loadClientPath]);

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs animate-in fade-in-0 duration-150" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-white p-6 shadow-xl animate-in zoom-in-95 fade-in-0 duration-150 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-4 dark:border-neutral-800">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                <MonitorCheck className="h-4 w-4" />
              </div>
              <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                客户端设置
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="关闭"
                className="rounded-md p-1.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Antigravity 可执行文件路径
              </label>
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                默认自动探测本机运行进程或标准安装目录。若安装于非标准目录，可在此手动指定。
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={clientPath || '自动探测 (默认路径)'}
                  placeholder="未指定自定义路径，系统将自动探测"
                  className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-800 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
                />
                <button
                  onClick={selectClientPath}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 shadow-xs hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>浏览...</span>
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-400">
              <span className="font-medium text-neutral-800 dark:text-neutral-200">数据与安全说明：</span>
              <ul className="mt-1.5 list-inside list-disc space-y-1">
                <li>账号与额度持久化于 <code className="rounded bg-neutral-200/60 px-1 py-0.5 text-[11px] dark:bg-neutral-800">%LOCALAPPDATA%\CodeTool</code></li>
                <li>敏感 Token 仅保存在本机 Windows 凭据管理器，不会上传至第三方服务器</li>
                <li>首版原生支持 Antigravity 经典桌面版热切号与重启</li>
              </ul>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white shadow-xs hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              完成
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
