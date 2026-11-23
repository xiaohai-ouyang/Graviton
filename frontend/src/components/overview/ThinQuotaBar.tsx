import React from 'react';
import { QuotaProgressBar } from '../QuotaProgressBar';

interface ThinQuotaBarProps {
  /** Percentage width to fill (0-100, or <0 for unknown). */
  barPct: number;
  /** Remaining percentage (0-100, or <0 for unknown) used for health semantics. */
  remainingPct: number;
  ariaLabel?: string;
  className?: string;
}

/**
 * Sleek solid progress bar tailored for high-density Bento cards and tables.
 * Fill width follows barPct (remaining or used), while health color always follows remainingPct.
 */
export const ThinQuotaBar: React.FC<ThinQuotaBarProps> = ({
  barPct,
  remainingPct,
  ariaLabel,
  className = '',
}) => (
  <QuotaProgressBar
    percentage={barPct}
    colorPercentage={remainingPct}
    size="sm"
    ariaLabel={ariaLabel}
    className={className}
  />
);
