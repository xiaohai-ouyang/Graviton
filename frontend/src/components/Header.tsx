import React, { useState } from 'react';
import { useAccountStore } from '../store/useAccountStore';
import { UserPlus, RefreshCw, Settings, ShieldCheck, PictureInPicture2 } from 'lucide-react';
import { ClientPathModal } from './ClientPathModal';
import { AddAccountModal } from './AddAccountModal';
import { ThemeToggle } from './ThemeToggle';

export const Header: React.FC = () => {
  const {
    accounts,
    capturing,
    refreshingAll,
    refreshAllQuotas,
    widgetOpen,
    toggleWidget,
  } = useAccountStore();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Check if current account is identified
  const currentAccount = accounts.find((a) => a.isCurrent);

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-neutral-200/80 bg-card/80 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/80">
        <div className="mx-auto flex flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-xs dark:bg-neutral-100 dark:text-neutral-900">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                  CodeTool
                </h1>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  Antigravity 管理器
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {currentAccount ? (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    当前客户端账号：<strong className="font-medium text-neutral-800 dark:text-neutral-200">{currentAccount.email}</strong>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                    当前客户端账号：未知
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setAddOpen(true)}
              disabled={capturing || refreshingAll}
              aria-label="添加账号"
              className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3.5 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>添加账号</span>
            </button>

            <button
              onClick={refreshAllQuotas}
              disabled={capturing || refreshingAll || accounts.length === 0}
              aria-label="刷新全部额度"
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-card px-3.5 py-2 text-xs font-medium text-neutral-700 shadow-xs transition-colors hover:bg-neutral-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshingAll ? 'animate-spin' : ''}`} />
              <span>{refreshingAll ? '正在刷新全部...' : '刷新全部'}</span>
            </button>

            <button
              onClick={toggleWidget}
              aria-label="切换桌面悬浮窗"
              title={widgetOpen ? '关闭桌面悬浮窗' : '开启桌面悬浮窗'}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium shadow-xs transition-colors active:scale-[0.98] ${
                widgetOpen
                  ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700 hover:bg-emerald-100/80 dark:border-emerald-500/40 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60'
                  : 'border-neutral-200 bg-card text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
              }`}
            >
              <PictureInPicture2 className="h-3.5 w-3.5" />
              <span>{widgetOpen ? '悬浮窗已开' : '悬浮窗'}</span>
            </button>

            <ThemeToggle />

            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="客户端路径与设置"
              title="客户端设置"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-600 shadow-xs transition-colors hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ClientPathModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
};
