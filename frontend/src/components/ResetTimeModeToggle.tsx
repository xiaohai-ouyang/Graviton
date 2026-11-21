import React from 'react';
import { CalendarClock, Timer } from 'lucide-react';
import { motion } from 'motion/react';
import { useMotionStore } from '../store/useMotionStore';
import { useResetTimeStore } from '../store/useResetTimeStore';
import { ResetTimeFormat } from '../utils/quota';

export const ResetTimeModeToggle: React.FC = () => {
  const { resetTimeFormat, setResetTimeFormat } = useResetTimeStore();
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  const options: {
    format: ResetTimeFormat;
    label: string;
    tooltip: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      format: 'countdown',
      label: '倒计时',
      tooltip: '显示距离重置的剩余时间（如：还有6天5小时重置）',
      icon: Timer,
    },
    {
      format: 'absolute',
      label: '具体时间',
      tooltip: '显示具体重置时间点（如：11月29日 06:38 重置）',
      icon: CalendarClock,
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="重置时间显示格式切换"
      className="inline-flex items-center rounded-lg border border-neutral-200 bg-neutral-100/90 p-0.5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/90"
    >
      {options.map(({ format, label, tooltip, icon: Icon }) => {
        const isActive = resetTimeFormat === format;
        return (
          <button
            key={format}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={tooltip}
            onClick={() => setResetTimeFormat(format)}
            className={`relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
              isActive
                ? 'font-semibold text-neutral-900 dark:text-neutral-50'
                : 'font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId={shouldAnimate ? 'reset-time-mode-active-pill' : undefined}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 rounded-md bg-card shadow-2xs dark:bg-neutral-800"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
};
