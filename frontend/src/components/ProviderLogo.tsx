import React from 'react';
import antigravityLogo from '../assets/images/logo-antigravity.png';
import qwenLogo from '../assets/images/logo-qwen.png';
import deepseekLogo from '../assets/images/logo-deepseek.svg';

export type ProviderId = 'antigravity' | 'qianwen' | 'deepseek';
export type ProviderLogoSize = 'xs' | 'sm' | 'row' | 'md' | 'avatar' | 'lg';

interface ProviderLogoProps {
  provider: ProviderId;
  size?: ProviderLogoSize;
  className?: string;
}

const PROVIDER_META: Record<ProviderId, { src: string; alt: string }> = {
  antigravity: {
    src: antigravityLogo,
    alt: 'Antigravity',
  },
  qianwen: {
    src: qwenLogo,
    alt: '千问',
  },
  deepseek: {
    src: deepseekLogo,
    alt: 'DeepSeek',
  },
};

export const ProviderLogo: React.FC<ProviderLogoProps> = ({
  provider,
  size = 'md',
  className = '',
}) => {
  const { src, alt } = PROVIDER_META[provider];

  if (size === 'xs') {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`h-4 w-4 shrink-0 select-none object-contain ${
          provider === 'qianwen' ? 'rounded-[4px]' : ''
        } ${className}`}
      />
    );
  }

  if (provider === 'antigravity') {
    const boxClasses: Record<Exclude<ProviderLogoSize, 'xs'>, string> = {
      sm: 'h-6 w-6 rounded-lg p-0.5 shadow-2xs',
      row: 'h-7 w-7 rounded-lg p-0.5 shadow-2xs',
      md: 'h-8 w-8 rounded-lg p-0.5 shadow-2xs',
      avatar: 'h-9 w-9 rounded-xl p-1 shadow-2xs',
      lg: 'h-14 w-14 rounded-2xl p-2 shadow-xs',
    };

    return (
      <span
        className={`flex shrink-0 items-center justify-center border border-neutral-200/80 bg-white dark:border-neutral-700/80 dark:bg-neutral-800/90 ${boxClasses[size]} ${className}`}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="h-full w-full select-none object-contain"
        />
      </span>
    );
  }

  if (provider === 'deepseek') {
    const dsBoxClasses: Record<Exclude<ProviderLogoSize, 'xs'>, string> = {
      sm: 'h-6 w-6 rounded-lg p-1 shadow-2xs',
      row: 'h-7 w-7 rounded-lg p-1 shadow-2xs',
      md: 'h-8 w-8 rounded-lg p-1.5 shadow-2xs',
      avatar: 'h-9 w-9 rounded-xl p-1.5 shadow-2xs',
      lg: 'h-14 w-14 rounded-2xl p-3 shadow-xs',
    };

    return (
      <span
        className={`flex shrink-0 items-center justify-center border border-blue-200/80 bg-blue-50/75 dark:border-blue-900/60 dark:bg-blue-950/45 ${dsBoxClasses[size]} ${className}`}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="h-full w-full select-none object-contain"
        />
      </span>
    );
  }

  // Qianwen logo already includes its blue rounded-square background (28x28 native)
  const qwenBoxClasses: Record<Exclude<ProviderLogoSize, 'xs'>, string> = {
    sm: 'h-6 w-6 overflow-hidden rounded-lg shadow-2xs',
    row: 'h-7 w-7 overflow-hidden rounded-lg shadow-2xs',
    md: 'h-8 w-8 overflow-hidden rounded-lg shadow-2xs',
    avatar:
      'h-9 w-9 rounded-xl border border-blue-200/70 bg-blue-50/70 p-1 shadow-2xs dark:border-blue-900/50 dark:bg-blue-950/40',
    lg: 'h-14 w-14 rounded-2xl border border-blue-200/70 bg-blue-50/70 p-3 shadow-xs dark:border-blue-900/50 dark:bg-blue-950/40',
  };

  return (
    <span
      className={`flex shrink-0 items-center justify-center ${qwenBoxClasses[size]} ${className}`}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="h-full w-full select-none object-contain"
      />
    </span>
  );
};
