import React from 'react';
import { getQuotaBarColor } from '../utils/quota';

interface QuotaProgressBarProps {
  percentage: number;
  size?: 'sm' | 'md';
  segments?: number;
  surface?: 'default' | 'widget';
  className?: string;
  ariaLabel?: string;
}

/**
 * Maps remaining percentage (0-100) to the number of lit ticks so any >0%
 * value lights at least 1 tick and any <100% value never appears completely full.
 */
function getFilledSegmentCount(percentage: number, segments: number): number {
  if (!Number.isFinite(percentage) || percentage <= 0) return 0;
  if (percentage >= 100) return segments;
  return Math.min(segments - 1, Math.max(1, Math.round((percentage / 100) * segments)));
}

export const QuotaProgressBar: React.FC<QuotaProgressBarProps> = ({
  percentage,
  size = 'md',
  segments,
  surface = 'default',
  className = '',
  ariaLabel,
}) => {
  const totalSegments = segments ?? (size === 'sm' ? 28 : 36);
  const isUnknown = !Number.isFinite(percentage) || percentage < 0;
  const clamped = isUnknown ? 0 : Math.max(0, Math.min(100, Math.round(percentage)));
  const filledCount = isUnknown ? 0 : getFilledSegmentCount(clamped, totalSegments);

  const litColorClass = getQuotaBarColor(clamped);
  const unlitColorClass =
    surface === 'widget'
      ? 'bg-neutral-200/90 dark:bg-neutral-700/80'
      : 'bg-neutral-200/85 dark:bg-neutral-800';
  const tickSizeClass = size === 'sm' ? 'h-[9px] max-w-[5px]' : 'h-3 max-w-[5px]';

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isUnknown ? undefined : clamped}
      aria-label={ariaLabel}
      className={`flex w-full items-center justify-between gap-[2px] ${className}`.trim()}
    >
      {Array.from({ length: totalSegments }, (_, idx) => (
        <span
          key={idx}
          aria-hidden="true"
          className={`flex-1 rounded-full transition-colors duration-200 ${tickSizeClass} ${
            idx < filledCount ? litColorClass : unlitColorClass
          }`}
        />
      ))}
    </div>
  );
};
