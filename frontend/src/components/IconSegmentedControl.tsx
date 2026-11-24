import React, { useId } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { motion } from 'motion/react';
import { useMotionStore } from '../store/useMotionStore';

export interface IconSegmentedOption<T extends string> {
  value: T;
  label: string;
  tooltip: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface IconSegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: IconSegmentedOption<T>[];
  ariaLabel: string;
  layoutIdPrefix?: string;
  size?: 'sm' | 'md';
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
}

export const TOOLTIP_CONTENT_CLASS =
  'z-[70] rounded-lg border border-neutral-200/20 bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-neutral-100 shadow-lg dark:border-neutral-700 dark:bg-neutral-800';

export function IconSegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  layoutIdPrefix = 'icon-seg',
  size = 'md',
  tooltipSide = 'top',
}: IconSegmentedControlProps<T>) {
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);
  const instanceId = useId();

  const containerClass =
    size === 'sm'
      ? 'inline-flex h-7 items-center rounded-lg border border-neutral-200/90 bg-neutral-100/80 p-0.5 dark:border-neutral-800 dark:bg-neutral-950/70'
      : 'inline-flex items-center rounded-lg border border-neutral-200 bg-neutral-100/90 p-0.5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/90';

  const buttonSizeClass = size === 'sm' ? 'h-full w-6' : 'h-7 w-7';
  const iconSizeClass = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5';

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={containerClass}>
      {options.map(({ value: optValue, label, tooltip, icon: Icon }) => {
        const isActive = value === optValue;
        return (
          <Tooltip.Root key={optValue}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                role="radio"
                aria-checked={isActive}
                aria-label={label}
                onClick={() => onChange(optValue)}
                className={`relative flex ${buttonSizeClass} items-center justify-center rounded-md transition-colors ${
                  isActive
                    ? 'text-neutral-900 dark:text-neutral-50'
                    : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId={shouldAnimate ? `${layoutIdPrefix}-${instanceId}` : undefined}
                    transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                    className="absolute inset-0 rounded-md bg-card shadow-2xs dark:bg-neutral-800"
                  />
                )}
                <Icon className={`relative z-10 ${iconSizeClass}`} />
                <span className="sr-only">{label}</span>
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side={tooltipSide} sideOffset={6} className={TOOLTIP_CONTENT_CLASS}>
                {tooltip}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        );
      })}
    </div>
  );
}
