import React from 'react';
import { useThemeStore, Theme } from '../store/useThemeStore';
import { Sun, Moon, Monitor } from 'lucide-react';

interface ThemeToggleProps {
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ compact = false }) => {
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

  if (compact) {
    const currentIndex = options.findIndex((o) => o.mode === theme);
    const current = options[currentIndex] ?? options[0];
    const next = options[(currentIndex + 1) % options.length];
    const Icon = current.icon;

    return (
      <button
        type="button"
        onClick={() => setTheme(next.mode)}
        title={`${current.tooltip}（点击切换为${next.label}）`}
        aria-label={`当前${current.label}，点击切换主题`}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-600 shadow-2xs transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  }

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
