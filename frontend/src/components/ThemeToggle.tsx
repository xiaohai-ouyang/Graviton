import React from 'react';
import { useThemeStore, Theme } from '../store/useThemeStore';
import { Sun, Moon, Monitor } from 'lucide-react';

export const ThemeToggle: React.FC = () => {
  const { theme, resolvedTheme, setTheme } = useThemeStore();

  const options: { mode: Theme; label: string; tooltip: string; icon: React.ComponentType<{ className?: string }> }[] = [
    {
      mode: 'system',
      label: '跟随系统',
      tooltip: `跟随系统 (${resolvedTheme === 'dark' ? '当前深色' : '当前浅色'})`,
      icon: Monitor,
    },
    {
      mode: 'light',
      label: '浅色模式',
      tooltip: '浅色模式',
      icon: Sun,
    },
    {
      mode: 'dark',
      label: '深色模式',
      tooltip: '深色模式',
      icon: Moon,
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="界面主题切换"
      className="inline-flex items-center rounded-lg border border-neutral-200 bg-neutral-100/90 p-0.5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/90"
    >
      {options.map(({ mode, label, tooltip, icon: Icon }) => {
        const isActive = theme === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={tooltip}
            aria-label={label}
            onClick={() => setTheme(mode)}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-all ${
              isActive
                ? 'bg-card text-card-foreground shadow-2xs dark:bg-neutral-800 dark:text-neutral-50 font-semibold'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
};
