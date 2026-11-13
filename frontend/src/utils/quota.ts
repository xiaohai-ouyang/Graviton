import { AccountDisplay, QuotaGroup } from '../types';

export function formatRelativeTime(isoStr?: string): string {
  if (!isoStr) return '从未';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

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

export function formatResetTime(resetTime?: string): string {
  if (!resetTime) return '未知';
  try {
    const d = new Date(resetTime);
    if (isNaN(d.getTime())) return resetTime;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    if (isToday) return `今日 ${hours}:${minutes}`;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${hours}:${minutes}`;
  } catch {
    return resetTime;
  }
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
