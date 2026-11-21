import React from 'react';
import { Cpu, Sparkles, ZapOff } from 'lucide-react';
import { motion } from 'motion/react';
import { MotionMode, useMotionStore } from '../store/useMotionStore';

export const MotionToggle: React.FC = () => {
  const { motionMode, resolvedMotion, shouldAnimate, autoReason, setMotionMode } =
    useMotionStore();

  const options: {
    mode: MotionMode;
    label: string;
    tooltip: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      mode: 'auto',
      label: '自动 (按性能)',
      tooltip: autoReason,
      icon: Cpu,
    },
    {
      mode: 'full',
      label: '开启全部',
      tooltip: '始终开启页面切换、列表展开收缩与排序过渡效果',
      icon: Sparkles,
    },
    {
      mode: 'off',
      label: '关闭效果',
      tooltip: '关闭所有界面过渡与动画效果，获得最快响应速度',
      icon: ZapOff,
    },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="过渡动效模式切换"
      className="inline-flex items-center rounded-lg border border-neutral-200 bg-neutral-100/90 p-0.5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/90"
    >
      {options.map(({ mode, label, tooltip, icon: Icon }) => {
        const isActive = motionMode === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={tooltip}
            onClick={() => setMotionMode(mode)}
            className={`relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
              isActive
                ? 'font-semibold text-neutral-900 dark:text-neutral-50'
                : 'font-medium text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId={shouldAnimate ? 'motion-mode-active-pill' : undefined}
                transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                className=" inset-0 absolute rounded-md bg-card shadow-2xs dark:bg-neutral-800"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
              {mode === 'auto' && isActive && (
                <span
                  className={`rounded px-1 py-0.2 text-[10px] font-medium ${
                    resolvedMotion === 'full'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                      : 'bg-neutral-200/80 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  {resolvedMotion === 'full' ? '已开' : '已关'}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};
