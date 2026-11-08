import React, { useEffect } from 'react';
import { useAccountStore } from './store/useAccountStore';
import { useThemeStore } from './store/useThemeStore';
import { Header } from './components/Header';
import { FeedbackBanner } from './components/FeedbackBanner';
import { AccountRow } from './components/AccountRow';
import { DeleteConfirmModal } from './components/DeleteConfirmModal';
import { Users, UserPlus } from 'lucide-react';

export const App: React.FC = () => {
  const { accounts, loading, loadAccounts, captureCurrentAccount } = useAccountStore();
  const initTheme = useThemeStore((s) => s.initTheme);

  useEffect(() => {
    loadAccounts();
    const cleanup = initTheme();
    return cleanup;
  }, [loadAccounts, initTheme]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100 flex flex-col">
      <Header />
      <FeedbackBanner />

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {loading && accounts.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-neutral-400">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-800 dark:border-neutral-700 dark:border-t-neutral-200" />
            <p className="text-xs">正在加载账号数据与凭据...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-card/50 p-12 text-center dark:border-neutral-800 dark:bg-neutral-900/30">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              <Users className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-neutral-800 dark:text-neutral-200">
              暂未收录任何 Antigravity 账号
            </h2>
            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
              点击上方「收录当前账号」，即可自动识别并收录本机当前登录的 Antigravity 账号，查看各模型组配额并在多账号间快速切换。
            </p>
            <button
              onClick={captureCurrentAccount}
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.98] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <UserPlus className="h-4 w-4" />
              <span>收录当前登录账号</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 px-1">
              <span>已收录账号 ({accounts.length})</span>
              <span>按收录顺序展示</span>
            </div>

            <div className="space-y-2.5">
              {accounts.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-neutral-200/80 bg-card py-3.5 text-center text-[11px] text-neutral-500 dark:border-neutral-800/80 dark:bg-neutral-900/50 dark:text-neutral-400">
        <p>
          CodeTool · Antigravity 多账号管理与配额工具 · 数据保存在 <code className="rounded bg-neutral-100 px-1 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">%LOCALAPPDATA%\CodeTool</code>
        </p>
        <p className="mt-1 text-[10px] text-neutral-400/90 dark:text-neutral-500">
          核心协议与客户端集成移植自 <a href="https://github.com/lbjlaq/Antigravity-Manager" target="_blank" rel="noreferrer" className="underline hover:text-neutral-800 dark:hover:text-neutral-200">Antigravity-Manager</a> · CC BY-NC-SA 4.0 许可证
        </p>
      </footer>

      <DeleteConfirmModal />
    </div>
  );
};

export default App;
