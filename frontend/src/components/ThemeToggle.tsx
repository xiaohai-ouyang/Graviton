import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Theme, useThemeStore } from '../store/useThemeStore';
import {
  IconSegmentedControl,
  IconSegmentedOption,
  TOOLTIP_CONTENT_CLASS,
} from './IconSegmentedControl';

interface ThemeToggleProps {
  compact?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ compact = false }) => {
  const { theme, resolvedTheme, setTheme } = useThemeStore();

  const options: IconSegmentedOption<Theme>[] = [
    {
      value: 'system',
      label: '跟随系统',
      tooltip: `跟随系统 · 当前${resolvedTheme === 'dark' ? '深色' : '浅色'}`,
      icon: Monitor,
    },
    {
      value: 'light',
      label: '浅色模式',
      tooltip: '浅色模式',
      icon: Sun,
    },
    {
      value: 'dark',
      label: '深色模式',
      tooltip: '深色模式',
      icon: Moon,
    },
  ];

  if (compact) {
    const currentIndex = options.findIndex((o) => o.value === theme);
    const current = options[currentIndex] ?? options[0];
    const next = options[(currentIndex + 1) % options.length];
    const Icon = current.icon;

    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            onClick={() => setTheme(next.value)}
            aria-label={`当前${current.label}，点击切换为${next.label}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-600 shadow-2xs transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
          >
            <Icon className="h-4 w-4" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="right" sideOffset={8} className={TOOLTIP_CONTENT_CLASS}>
            {current.tooltip}（点击切换为{next.label}）
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    );
  }

  return (
    <IconSegmentedControl
      value={theme}
      onChange={setTheme}
      options={options}
      ariaLabel="界面主题切换"
      layoutIdPrefix="theme-pill"
    />
  );
};
