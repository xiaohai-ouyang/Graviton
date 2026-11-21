import { AccountDisplay, QuotaGroup } from '../types';

export type ResetTimeFormat = 'countdown' | 'absolute';

export function formatRelativeTime(isoStr?: string, nowMs = Date.now()): string {
  if (!isoStr) return '从未';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const diffSec = Math.floor((nowMs - d.getTime()) / 1000);

    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;

    const month = d.getMonth() + 1;
    const date = d.getDate();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}月${date}日 ${hours}:${minutes}`;
  } catch {
    return isoStr;
  }
}

export function formatResetTime(resetTime?: string, nowMs = Date.now()): string {
  if (!resetTime) return '未知';
  try {
    const d = new Date(resetTime);
    if (isNaN(d.getTime())) return resetTime;
    const now = new Date(nowMs);
    const isToday = d.toDateString() === now.toDateString();

    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    if (isToday) return `今日 ${hours}:${minutes}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hours}:${minutes}`;
  } catch {
    return resetTime;
  }
}

export function formatResetCountdown(
  resetTime?: string,
  nowMs = Date.now(),
  compact = false
): string {
  if (!resetTime) return '未知';
  const d = new Date(resetTime);
  if (isNaN(d.getTime())) return resetTime;

  const diffMs = d.getTime() - nowMs;
  if (diffMs <= 0) return '已重置';

  const totalMin = Math.floor(diffMs / 60000);
  if (totalMin < 1) return '即将重置';

  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;

  if (days > 0) {
    if (compact) {
      return hours > 0 ? `${days}天${hours}时` : `${days}天`;
    }
    return hours > 0 ? `还有${days}天${hours}小时重置` : `还有${days}天重置`;
  }

  if (hours > 0) {
    if (compact) {
      return mins > 0 ? `${hours}时${mins}分` : `${hours}小时`;
    }
    return mins > 0 ? `还有${hours}小时${mins}分钟重置` : `还有${hours}小时重置`;
  }

  return compact ? `${mins}分钟` : `还有${mins}分钟重置`;
}

export function formatResetDisplay(
  resetTime: string | undefined,
  format: ResetTimeFormat,
  options?: {
    nowMs?: number;
    compact?: boolean;
    absoluteStyle?: 'suffix' | 'prefix' | 'bare';
  }
): { text: string; tooltip?: string } {
  const nowMs = options?.nowMs ?? Date.now();
  const compact = options?.compact ?? false;
  const absoluteStyle = options?.absoluteStyle ?? 'bare';

  if (!resetTime) return { text: '未知' };
  const d = new Date(resetTime);
  if (isNaN(d.getTime())) return { text: resetTime };

  const absBase = formatResetTime(resetTime, nowMs);
  const countdownText = formatResetCountdown(resetTime, nowMs, compact);
  const countdownFull = compact
    ? formatResetCountdown(resetTime, nowMs, false)
    : countdownText;

  if (format === 'countdown') {
    return {
      text: countdownText,
      tooltip: `重置时间：${absBase}`,
    };
  }

  let text = absBase;
  if (absoluteStyle === 'suffix') {
    text = `${absBase} 重置`;
  } else if (absoluteStyle === 'prefix') {
    text = `重置：${absBase}`;
  }

  return {
    text,
    tooltip: countdownFull,
  };
}

export function formatBucketLabel(label?: string): string {
  if (!label) return '配额窗口';
  const lower = label.toLowerCase();
  if (lower.includes('weekly')) return '周限额 (Weekly)';
  if (lower.includes('five hour') || lower.includes('5 hour') || lower.includes('5h')) {
    return '5 小时限额 (5h)';
  }
  return label;
}

export function getQuotaTextColor(pct: number): string {
  if (pct < 0) return 'text-neutral-400 dark:text-neutral-500';
  if (pct <= 15) return 'text-rose-600 dark:text-rose-400';
  if (pct <= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

export function getQuotaBarColor(pct: number): string {
  if (pct <= 15) return 'bg-rose-500';
  if (pct <= 50) return 'bg-amber-500';
  return 'bg-emerald-500 dark:bg-emerald-400';
}

/**
 * Returns the effective remaining percentage (0-100) for a given model group keyword
 * (e.g., 'gemini' or 'claude'), using the minimum remaining bucket in that group
 * (since if weekly limit is 0%, the group is effectively exhausted).
 * Returns -1 if no matching group or buckets exist.
 */
export function getGroupEffectivePct(account: AccountDisplay, keyword: string): number {
  const groups: QuotaGroup[] = account.groups || [];
  const lowerKey = keyword.toLowerCase();
  const group = groups.find((g) => (g.displayName || '').toLowerCase().includes(lowerKey));
  if (!group || !group.buckets || group.buckets.length === 0) {
    return -1;
  }
  const pcts = group.buckets.map((b) => Math.round(b.remainingFraction * 100));
  return Math.min(...pcts);
}
