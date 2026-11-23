import React from 'react';
import { getQuotaBarColor } from '../../utils/quota';

interface ThinQuotaBarProps {
  /** Percentage width to fill (0-100, or <0 for unknown). */
  barPct: number;
  /** Remaining percentage (0-100, or <0 for unknown) used for health semantics. */
  remainingPct: number;
  ariaLabel?: string;
  className?: string;
}

/**
 * Sleek continuous progress bar tailored for high-density Bento cards and tables.
 * Fill width follows barPct (remaining or used), while health color always follows remainingPct.
 */
export const ThinQuotaBar: React.FC<ThinQuotaBarProps> = ({
  barPct,
  remainingPct,
  ariaLabel,
  className = '',
}) => {
  const isUnknown = !Number.isFinite(barPct) || barPct < 0;
  const clampedWidth = isUnknown ? 0 : Math.max(0, Math.min(100, Math.round(barPct)));
  const colorClass = isUnknown
    ? 'bg-neutral-300 dark:bg-neutral-700'
    : getQuotaBarColor(remainingPct);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isUnknown ? undefined : clampedWidth}
      aria-label={ariaLabel}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-neutral-200/85 dark:bg-neutral-800 ${className}`.trim()}
    >
      <div
        style={{ width: `${clampedWidth}%` }}
        className={`h-full rounded-full transition-[width] duration-200 ${colorClass}`}
      />
    </div>
  );
};
