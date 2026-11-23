import { create } from 'zustand';
import { BestAccountDimension, QuotaDisplayMode } from '../utils/quota';

export type OverviewViewMode = 'card' | 'table';

const STORAGE_KEY = 'graviton_overview_prefs';

interface PersistedOverviewPrefs {
  viewMode: OverviewViewMode;
  quotaDisplayMode: QuotaDisplayMode;
  maskAccount: boolean;
  bestDimension: BestAccountDimension;
}

const DEFAULT_PREFS: PersistedOverviewPrefs = {
  viewMode: 'card',
  quotaDisplayMode: 'remaining',
  maskAccount: false,
  bestDimension: 'overall',
};

function loadPersistedPrefs(): PersistedOverviewPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<PersistedOverviewPrefs>;
    return {
      viewMode: parsed.viewMode === 'table' ? 'table' : 'card',
      quotaDisplayMode: parsed.quotaDisplayMode === 'used' ? 'used' : 'remaining',
      maskAccount: Boolean(parsed.maskAccount),
      bestDimension:
        parsed.bestDimension === 'gemini' || parsed.bestDimension === 'claude'
          ? parsed.bestDimension
          : 'overall',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePersistedPrefs(prefs: PersistedOverviewPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage errors
  }
}

interface OverviewPrefsState extends PersistedOverviewPrefs {
  setViewMode: (mode: OverviewViewMode) => void;
  setQuotaDisplayMode: (mode: QuotaDisplayMode) => void;
  toggleMaskAccount: () => void;
  setBestDimension: (dim: BestAccountDimension) => void;
}

const initial = loadPersistedPrefs();

export const useOverviewPrefsStore = create<OverviewPrefsState>((set, get) => ({
  ...initial,
  setViewMode: (viewMode) => {
    set({ viewMode });
    const { quotaDisplayMode, maskAccount, bestDimension } = get();
    savePersistedPrefs({ viewMode, quotaDisplayMode, maskAccount, bestDimension });
  },
  setQuotaDisplayMode: (quotaDisplayMode) => {
    set({ quotaDisplayMode });
    const { viewMode, maskAccount, bestDimension } = get();
    savePersistedPrefs({ viewMode, quotaDisplayMode, maskAccount, bestDimension });
  },
  toggleMaskAccount: () => {
    const maskAccount = !get().maskAccount;
    set({ maskAccount });
    const { viewMode, quotaDisplayMode, bestDimension } = get();
    savePersistedPrefs({ viewMode, quotaDisplayMode, maskAccount, bestDimension });
  },
  setBestDimension: (bestDimension) => {
    set({ bestDimension });
    const { viewMode, quotaDisplayMode, maskAccount } = get();
    savePersistedPrefs({ viewMode, quotaDisplayMode, maskAccount, bestDimension });
  },
}));
