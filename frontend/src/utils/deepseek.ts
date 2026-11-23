import { DeepSeekAccountDisplay, DeepSeekBalanceInfo, DeepSeekBalanceSnapshot } from '../types';

export type DeepSeekBalanceTone = 'healthy' | 'low' | 'unavailable';

const LOW_BALANCE_THRESHOLDS: Record<string, number> = {
  CNY: 10,
  USD: 2,
};

export function parseBalanceAmount(raw?: string): number {
  if (!raw) return 0;
  const parsed = Number.parseFloat(String(raw).trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function currencySymbol(currency?: string): string {
  const code = (currency || 'CNY').toUpperCase();
  if (code === 'CNY') return '¥';
  if (code === 'USD') return '$';
  return `${code} `;
}

export function formatCurrencyAmount(currency?: string, raw?: string | number): string {
  const sym = currencySymbol(currency);
  const num = typeof raw === 'number' ? raw : parseBalanceAmount(raw);
  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sym}${formatted}`;
}

export function getBalanceInfoTone(
  isAvailable: boolean,
  info: DeepSeekBalanceInfo
): DeepSeekBalanceTone {
  const total = parseBalanceAmount(info.totalBalance);
  if (!isAvailable || total <= 0) {
    return 'unavailable';
  }
  const code = (info.currency || 'CNY').toUpperCase();
  const lowThreshold = LOW_BALANCE_THRESHOLDS[code] ?? 10;
  if (total < lowThreshold) {
    return 'low';
  }
  return 'healthy';
}

export function getAccountBalanceTone(
  balance?: DeepSeekBalanceSnapshot
): DeepSeekBalanceTone {
  if (!balance || balance.authInvalid || !balance.isAvailable) {
    return 'unavailable';
  }
  const infos = balance.balanceInfos || [];
  if (infos.length === 0) {
    return 'unavailable';
  }
  const tones = infos.map((info) => getBalanceInfoTone(balance.isAvailable, info));
  if (tones.includes('healthy')) return 'healthy';
  if (tones.includes('low')) return 'low';
  return 'unavailable';
}

export function getDeepSeekStatusBadge(balance?: DeepSeekBalanceSnapshot): {
  label: string;
  tone: DeepSeekBalanceTone;
} {
  if (balance?.authInvalid) {
    return { label: 'Key 失效', tone: 'unavailable' };
  }
  if (!balance?.isAvailable) {
    return { label: '余额不足', tone: 'unavailable' };
  }
  const tone = getAccountBalanceTone(balance);
  if (tone === 'unavailable') {
    return { label: '余额不足', tone: 'unavailable' };
  }
  if (tone === 'low') {
    return { label: '余额偏低', tone: 'low' };
  }
  return { label: '可用', tone: 'healthy' };
}

export function getDeepSeekAmountColorClass(tone: DeepSeekBalanceTone): string {
  if (tone === 'unavailable') {
    return 'text-rose-600 dark:text-rose-400';
  }
  if (tone === 'low') {
    return 'text-amber-600 dark:text-amber-400';
  }
  return 'text-emerald-600 dark:text-emerald-400';
}

export function getDeepSeekBadgeClass(tone: DeepSeekBalanceTone): string {
  if (tone === 'unavailable') {
    return 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300';
  }
  if (tone === 'low') {
    return 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300';
  }
  return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
}

export function maskDeepSeekKeyPreview(preview?: string): string {
  if (!preview) return 'sk-****';
  return 'sk-****';
}

export interface DeepSeekCurrencyAggregate {
  currency: string;
  totalBalance: number;
  toppedUpBalance: number;
  grantedBalance: number;
}

export interface DeepSeekSummary {
  currencies: DeepSeekCurrencyAggregate[];
  availableCount: number;
  unavailableCount: number;
  invalidKeyCount: number;
}

export function aggregateDeepSeekBalances(
  accounts: DeepSeekAccountDisplay[]
): DeepSeekSummary {
  const byCurrency = new Map<
    string,
    { totalCents: number; toppedCents: number; grantedCents: number }
  >();
  let availableCount = 0;
  let unavailableCount = 0;
  let invalidKeyCount = 0;

  for (const acc of accounts) {
    const bal = acc.balance;
    if (bal?.authInvalid) {
      invalidKeyCount += 1;
    } else if (bal?.isAvailable) {
      availableCount += 1;
    } else {
      unavailableCount += 1;
    }

    for (const info of bal?.balanceInfos || []) {
      const code = (info.currency || 'CNY').toUpperCase();
      const entry = byCurrency.get(code) ?? {
        totalCents: 0,
        toppedCents: 0,
        grantedCents: 0,
      };
      entry.totalCents += Math.round(parseBalanceAmount(info.totalBalance) * 100);
      entry.toppedCents += Math.round(parseBalanceAmount(info.toppedUpBalance) * 100);
      entry.grantedCents += Math.round(parseBalanceAmount(info.grantedBalance) * 100);
      byCurrency.set(code, entry);
    }
  }

  const order = (code: string) => (code === 'CNY' ? 0 : code === 'USD' ? 1 : 2);
  const currencies: DeepSeekCurrencyAggregate[] = Array.from(byCurrency.entries())
    .sort(([a], [b]) => {
      const diff = order(a) - order(b);
      return diff !== 0 ? diff : a.localeCompare(b);
    })
    .map(([currency, v]) => ({
      currency,
      totalBalance: v.totalCents / 100,
      toppedUpBalance: v.toppedCents / 100,
      grantedBalance: v.grantedCents / 100,
    }));

  return {
    currencies,
    availableCount,
    unavailableCount,
    invalidKeyCount,
  };
}
