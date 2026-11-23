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

export type BestAccountDimension = 'overall' | 'gemini' | 'claude';

export interface BestAccountCandidate {
  account: AccountDisplay;
  score: number; // 0-100, 当前维度得分
  minGroupPct: number; // 0-100 或 -1, 用于平局比较
}

export interface BestAccountSelection {
  currentScore: number; // 当前账号在选定维度的得分，无当前账号/受限/未知时为 -1
  bestSwitchCandidate: BestAccountCandidate | null;
  isCurrentAlreadyBest: boolean;
}

/** Per-group effective remaining percentages (min bucket per non-empty group). */
export function getAccountGroupScores(account: AccountDisplay): number[] {
  const groups: QuotaGroup[] = account.groups || [];
  const scores: number[] = [];
  for (const group of groups) {
    if (!group.buckets || group.buckets.length === 0) continue;
    scores.push(Math.min(...group.buckets.map((b) => Math.round(b.remainingFraction * 100))));
  }
  return scores;
}

/** Overall score: average and weakest-link across model groups, falling back to remainingPercentage. */
export function getAccountOverallScore(account: AccountDisplay): { avg: number; min: number } {
  const groupScores = getAccountGroupScores(account);
  if (groupScores.length > 0) {
    const sum = groupScores.reduce((acc, s) => acc + s, 0);
    return { avg: Math.round(sum / groupScores.length), min: Math.min(...groupScores) };
  }
  const fallback =
    typeof account.remainingPercentage === 'number' ? account.remainingPercentage : -1;
  return { avg: fallback, min: fallback };
}

export function getAccountDimensionScore(
  account: AccountDisplay,
  dimension: BestAccountDimension
): number {
  if (dimension === 'gemini') return getGroupEffectivePct(account, 'gemini');
  if (dimension === 'claude') return getGroupEffectivePct(account, 'claude');
  return getAccountOverallScore(account).avg;
}

const TIER_RANK: Record<string, number> = {
  ULTRA: 4,
  ENTERPRISE: 3,
  PRO: 2,
  FREE: 1,
};

function getTierRank(account: AccountDisplay): number {
  return TIER_RANK[(account.subscriptionTier || 'FREE').toUpperCase()] ?? 0;
}

/**
 * Picks the best non-current Antigravity account to switch to for the given
 * dimension, ordered by dimension score, then overall average, then weakest
 * group, then subscription tier. Forbidden / unknown-score accounts are skipped.
 */
export function pickBestAntigravityAccount(
  accounts: AccountDisplay[],
  dimension: BestAccountDimension
): BestAccountSelection {
  const current = accounts.find((a) => a.isCurrent) ?? null;
  const currentUsable = Boolean(current && !current.isForbidden);
  const currentScore = currentUsable
    ? getAccountDimensionScore(current!, dimension)
    : -1;

  let best: BestAccountCandidate | null = null;
  let bestOverall = { avg: -1, min: -1 };
  let bestTier = -1;

  for (const acc of accounts) {
    if (acc.isCurrent || acc.isForbidden) continue;
    const score = getAccountDimensionScore(acc, dimension);
    if (score < 0) continue;
    const overall = getAccountOverallScore(acc);
    const tier = getTierRank(acc);

    const better =
      !best ||
      score > best.score ||
      (score === best.score &&
        (overall.avg > bestOverall.avg ||
          (overall.avg === bestOverall.avg &&
            (overall.min > bestOverall.min ||
              (overall.min === bestOverall.min && tier > bestTier)))));

    if (better) {
      best = { account: acc, score, minGroupPct: overall.min };
      bestOverall = overall;
      bestTier = tier;
    }
  }

  const isCurrentAlreadyBest =
    currentUsable && currentScore >= 0 && (!best || currentScore >= best.score);

  return { currentScore, bestSwitchCandidate: best, isCurrentAlreadyBest };
}

export interface ProviderGroupAggregate {
  name: string;
  avgRemainingPct: number; // 0-100 或 -1
  validAccountCount: number;
}

/**
 * Aggregates average effective remaining percentage per model group across
 * all non-forbidden Antigravity accounts, preserving first-seen group order.
 */
export function aggregateAntigravityGroups(
  accounts: AccountDisplay[]
): ProviderGroupAggregate[] {
  const buckets = new Map<string, { sum: number; count: number }>();

  for (const acc of accounts) {
    if (acc.isForbidden) continue;
    for (const group of acc.groups || []) {
      if (!group.buckets || group.buckets.length === 0) continue;
      const name = group.displayName || '通用分组';
      const effectivePct = Math.min(
        ...group.buckets.map((b) => Math.round(b.remainingFraction * 100))
      );
      const entry = buckets.get(name) ?? { sum: 0, count: 0 };
      entry.sum += effectivePct;
      entry.count += 1;
      buckets.set(name, entry);
    }
  }

  return Array.from(buckets.entries()).map(([name, { sum, count }]) => ({
    name,
    avgRemainingPct: count > 0 ? Math.round(sum / count) : -1,
    validAccountCount: count,
  }));
}

/** Masks an email, phone number, or account identifier for privacy-safe screenshots. */
export function maskAccountIdentity(value?: string): string {
  const raw = (value ?? '').trim();
  if (!raw) return '***';

  const atIndex = raw.indexOf('@');
  if (atIndex > 0) {
    const local = raw.slice(0, atIndex);
    const domain = raw.slice(atIndex);
    const keep = local.length <= 2 ? 1 : Math.min(3, local.length - 1);
    return `${local.slice(0, keep)}***${domain}`;
  }

  if (raw.length > 5) {
    return `${raw.slice(0, 3)}****${raw.slice(-2)}`;
  }
  if (raw.length >= 2) {
    return `${raw.slice(0, 1)}***`;
  }
  return '***';
}

export type QuotaDisplayMode = 'remaining' | 'used';

export interface FormattedQuotaMetric {
  remainingPct: number; // 0-100 或 -1（决定语义健康色）
  barPct: number; // 0-100 或 -1（决定进度条宽度）
  label: string; // 如 "剩余 85%" / "已用 15%" / "未知"
  shortValue: string; // 如 "85%" / "15%" / "未知"
}

export function formatQuotaByMode(
  remainingPct: number,
  mode: QuotaDisplayMode
): FormattedQuotaMetric {
  if (!Number.isFinite(remainingPct) || remainingPct < 0) {
    return {
      remainingPct: -1,
      barPct: -1,
      label: '未知',
      shortValue: '未知',
    };
  }
  const clamped = Math.max(0, Math.min(100, Math.round(remainingPct)));
  if (mode === 'used') {
    const used = 100 - clamped;
    return {
      remainingPct: clamped,
      barPct: used,
      label: `已用 ${used}%`,
      shortValue: `${used}%`,
    };
  }
  return {
    remainingPct: clamped,
    barPct: clamped,
    label: `剩余 ${clamped}%`,
    shortValue: `${clamped}%`,
  };
}
