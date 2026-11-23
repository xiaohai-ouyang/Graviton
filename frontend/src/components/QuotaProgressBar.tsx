import React from 'react';
import { getQuotaBarColor } from '../utils/quota';

interface QuotaProgressBarProps {
  /** 进度条填充宽度百分比（0-100，或 <0 表示未知）。 */
  percentage: number;
  /** 可选：用于决定健康语义颜色的剩余百分比（0-100），默认与 percentage 一致。 */
  colorPercentage?: number;
  size?: 'sm' | 'md';
  surface?: 'default' | 'widget';
  className?: string;
  ariaLabel?: string;
}

export const QuotaProgressBar: React.FC<QuotaProgressBarProps> = ({
  percentage,
  colorPercentage,
  size = 'md',
  surface = 'default',
  className = '',
  ariaLabel,
}) => {
  const isUnknown = !Number.isFinite(percentage) || percentage < 0;
  const clamped = isUnknown ? 0 : Math.max(0, Math.min(100, Math.round(percentage)));
  const semanticPct = colorPercentage ?? clamped;

  const fillColorClass =
    isUnknown || !Number.isFinite(semanticPct) || semanticPct < 0
      ? 'bg-neutral-300 dark:bg-neutral-700'
      : getQuotaBarColor(semanticPct);
  const trackColorClass =
    surface === 'widget'
      ? 'bg-neutral-200/90 dark:bg-neutral-700/80'
      : 'bg-neutral-200/85 dark:bg-neutral-800';
  const heightClass = size === 'sm' ? 'h-1.5' : 'h-2';

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isUnknown ? undefined : clamped}
      aria-label={ariaLabel}
      className={`w-full overflow-hidden rounded-full ${heightClass} ${trackColorClass} ${className}`.trim()}
    >
      <div
        style={{ width: `${clamped}%` }}
        className={`h-full rounded-full transition-[width] duration-200 ${fillColorClass}`}
      />
    </div>
  );
};
