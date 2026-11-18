import React, { useEffect } from 'react';
import { FolderOpen, Layers, MonitorCheck, Palette, Shield } from 'lucide-react';
import { useAccountStore } from '../store/useAccountStore';
import { ThemeToggle } from '../components/ThemeToggle';

export const SettingsPage: React.FC = () => {
  const {
    clientPath,
    loadClientPath,
    selectClientPath,
    widgetAlwaysOnTop,
    loadWidgetAlwaysOnTop,
    setWidgetAlwaysOnTop,
  } = useAccountStore();

  useEffect(() => {
    loadClientPath();
    loadWidgetAlwaysOnTop();
  }, [loadClientPath, loadWidgetAlwaysOnTop]);

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-neutral-200/80 bg-card/80 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3.5">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              设置
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              配置客户端路径、界面主题与查看数据安全说明
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-5 px-6 py-6">
        {/* Client Path Card */}
        <section className="rounded-2xl border border-neutral-200/80 bg-card p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex items-center gap-2.5 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
              <MonitorCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                客户端路径
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                默认自动探测本机运行进程或标准安装目录。若安装于非标准目录，可在此手动指定。
              </p>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Antigravity 可执行文件路径
            </label>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                readOnly
                value={clientPath || '自动探测 (默认路径)'}
                placeholder="未指定自定义路径，系统将自动探测"
                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-800 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
              />
              <button
                type="button"
                onClick={selectClientPath}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-card px-3.5 py-2 text-xs font-medium text-neutral-700 shadow-xs transition-colors hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>浏览...</span>
              </button>
            </div>
          </div>
        </section>

        {/* Appearance Card */}
        <section className="rounded-2xl border border-neutral-200/80 bg-card p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                <Palette className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  界面外观
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  选择跟随系统、浅色或深色主题模式
                </p>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </section>

        {/* Floating Widget Card */}
        <section className="rounded-2xl border border-neutral-200/80 bg-card p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                <Layers className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  悬浮窗
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  控制桌面悬浮窗是否始终置顶于其他窗口之上（关闭后可避免遮挡鼠标点击）
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={widgetAlwaysOnTop}
              aria-label="悬浮窗置顶"
              onClick={() => void setWidgetAlwaysOnTop(!widgetAlwaysOnTop)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-hidden ${
                widgetAlwaysOnTop
                  ? 'bg-neutral-900 dark:bg-neutral-100'
                  : 'bg-neutral-200 dark:bg-neutral-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform dark:bg-neutral-900 ${
                  widgetAlwaysOnTop ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </section>

        {/* Data & Security Card */}
        <section className="rounded-2xl border border-neutral-200/80 bg-card p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex items-center gap-2.5 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
              <Shield className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              数据与安全说明
            </h3>
          </div>

          <ul className="mt-3.5 list-inside list-disc space-y-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            <li>
              账号与额度持久化于{' '}
              <code className="rounded bg-neutral-200/70 px-1.5 py-0.5 text-[11px] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                %LOCALAPPDATA%\CodeTool
              </code>
            </li>
            <li>敏感 Token 仅保存在本机 Windows 凭据管理器，不会上传至第三方服务器</li>
            <li>首版原生支持 Antigravity 经典桌面版热切号与重启</li>
          </ul>
        </section>
      </main>
    </>
  );
};
