import { create } from 'zustand';
import { AppInfo, ChangelogRelease } from '../types';
import { api } from '../services/api';

interface AppInfoState {
  appInfo: AppInfo | null;
  changelog: ChangelogRelease[];
  loaded: boolean;
  changelogOpen: boolean;

  loadAppInfo: () => Promise<void>;
  openChangelog: () => void;
  closeChangelog: () => void;
  setChangelogOpen: (open: boolean) => void;
}

export const useAppInfoStore = create<AppInfoState>((set, get) => ({
  appInfo: null,
  changelog: [],
  loaded: false,
  changelogOpen: false,

  loadAppInfo: async () => {
    if (get().loaded) return;
    try {
      const [appInfo, changelog] = await Promise.all([
        api.getAppInfo(),
        api.getChangelog(),
      ]);
      set({ appInfo, changelog, loaded: true });
    } catch {
      // Ignore outside Wails runtime
    }
  },

  openChangelog: () => set({ changelogOpen: true }),
  closeChangelog: () => set({ changelogOpen: false }),
  setChangelogOpen: (open) => set({ changelogOpen: open }),
}));
