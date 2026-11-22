import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { formatResetDisplay, ResetTimeFormat } from '../utils/quota';

interface ResetTimeTextProps {
  resetTime?: string;
  format: ResetTimeFormat;
  nowMs: number;
  absoluteStyle?: 'suffix' | 'prefix' | 'bare';
  className?: string;
}

export const ResetTimeText: React.FC<ResetTimeTextProps> = ({
  resetTime,
  format,
  nowMs,
  absoluteStyle = 'bare',
  className,
}) => {
  const { text, tooltip } = formatResetDisplay(resetTime, format, {
    nowMs,
    absoluteStyle,
  });

  if (!tooltip) {
    return <span className={className}>{text}</span>;
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span title="" className={className}>
          {text}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          className="z-[70] rounded-lg border border-neutral-200/20 bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-neutral-100 shadow-lg dark:border-neutral-700 dark:bg-neutral-800"
        >
          {tooltip}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};
