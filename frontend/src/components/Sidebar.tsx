import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  FileClock,
  Gauge,
  Layers,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useAppInfoStore } from '../store/useAppInfoStore';

const NAV_ITEMS = [
  { to: '/quota', label: '额度', icon: Gauge },
  { to: '/env', label: '环境', icon: Layers },
] as const;

export const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { appInfo, openChangelog } = useAppInfoStore();

  return (
    <aside
      className={`sticky top-0 z-20 flex h-screen shrink-0 flex-col border-r border-neutral-200/80 bg-card/85 backdrop-blur-md transition-[width] duration-200 dark:border-neutral-800 dark:bg-neutral-900/85 ${
        collapsed ? 'w-16' : 'w-52'
      }`}
    >
      {/* Brand Header (click to toggle sidebar) */}
      <div
        className={`flex h-16 items-center border-b border-neutral-200/70 px-3.5 dark:border-neutral-800/80 ${
          collapsed ? 'justify-center' : ''
        }`}
      >
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          title={collapsed ? '点击展开侧边栏' : '点击收起侧边栏'}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className={`group flex items-center gap-2.5 overflow-hidden rounded-xl text-left transition-opacity hover:opacity-85 active:scale-[0.98] ${
            collapsed ? 'justify-center' : 'w-full'
          }`}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-xs dark:bg-neutral-100 dark:text-neutral-900">
            <ShieldCheck className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
                CodeTool
              </h1>
              <p className="truncate text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
                Antigravity 管理器
              </p>
            </div>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav aria-label="主导航" className="flex-1 space-y-1 p-2.5">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              `flex items-center rounded-lg text-xs font-medium transition-colors ${
                collapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2.5'
              } ${
                isActive
                  ? 'bg-neutral-900 text-white shadow-xs dark:bg-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-100'
              }`
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Footer Utilities */}
      <div
        className={`border-t border-neutral-200/70 p-2.5 dark:border-neutral-800/80 ${
          collapsed ? 'flex flex-col items-center gap-2' : 'space-y-2'
        }`}
      >
        <div
          className={
            collapsed ? '' : 'flex items-center justify-between px-1'
          }
        >
          {!collapsed && (
            <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
              界面主题
            </span>
          )}
          <ThemeToggle compact={collapsed} />
        </div>

        <NavLink
          to="/settings"
          title={collapsed ? '设置' : undefined}
          className={({ isActive }) =>
            `flex items-center rounded-lg text-xs font-medium transition-colors ${
              collapsed ? 'h-9 w-9 justify-center' : 'w-full gap-2.5 px-3 py-2'
            } ${
              isActive
                ? 'bg-neutral-900 text-white shadow-xs dark:bg-neutral-100 dark:text-neutral-900'
                : 'border border-neutral-200 bg-card text-neutral-700 shadow-2xs hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
            }`
          }
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">设置</span>}
        </NavLink>

        {appInfo && (
          <button
            type="button"
            onClick={openChangelog}
            title={`CodeTool v${appInfo.version} — 点击查看更新日志`}
            className={`flex items-center rounded-lg text-[11px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800/80 dark:hover:text-neutral-100 ${
              collapsed
                ? 'h-8 w-9 justify-center'
                : 'w-full justify-between px-2.5 py-1.5'
            }`}
          >
            {collapsed ? (
              <FileClock className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <>
                <span className="inline-flex min-w-0 items-center gap-1.5 font-mono">
                  <FileClock className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">v{appInfo.version}</span>
                </span>
                {appInfo.channel !== 'stable' && (
                  <span
                    className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${
                      appInfo.channel === 'rc'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300'
                        : 'bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300'
                    }`}
                  >
                    {appInfo.channel}
                  </span>
                )}
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  );
};
