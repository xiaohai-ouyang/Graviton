import { create } from 'zustand';
import { api, parseError } from '../services/api';
import { UpdateState } from '../types';
import { useAccountStore } from './useAccountStore';

interface UpdateStoreState {
  state: UpdateState | null;
  modalOpen: boolean;
  promptedVersion: string | null;
  checking: boolean;
  savingSettings: boolean;

  loadUpdateState: () => Promise<void>;
  applyUpdateState: (next: UpdateState) => void;
  setModalOpen: (open: boolean) => void;
  checkForUpdates: () => Promise<void>;
  saveSettings: (autoCheck: boolean, mirrorURL: string) => Promise<boolean>;
  skipVersion: (version: string) => Promise<void>;
  requestInstall: () => Promise<void>;
  cancelDeferred: () => Promise<void>;
  dismissUpdatedNotice: () => Promise<void>;
}

const notify = (type: 'success' | 'error' | 'info', message: string) => {
  useAccountStore.getState().setBanner({ type, message });
};

export const useUpdateStore = create<UpdateStoreState>((set, get) => ({
  state: null,
  modalOpen: false,
  promptedVersion: null,
  checking: false,
  savingSettings: false,

  loadUpdateState: async () => {
    const st = await api.getUpdateState();
    if (st) get().applyUpdateState(st);
  },

  applyUpdateState: (next) => {
    const { promptedVersion } = get();
    const patch: Partial<UpdateStoreState> = { state: next };
    // First ready offer for a version in this session: highlight + open the modal once.
    if (
      next.status === 'ready' &&
      next.latestVersion &&
      next.latestVersion !== promptedVersion
    ) {
      patch.promptedVersion = next.latestVersion;
      patch.modalOpen = true;
    }
    set(patch);
  },

  setModalOpen: (open) => set({ modalOpen: open }),

  checkForUpdates: async () => {
    if (get().checking) return;
    set({ checking: true });
    try {
      const st = await api.checkForUpdates();
      get().applyUpdateState(st);
      if (st.status === 'up_to_date') {
        notify('success', '当前已是最新版本');
      }
    } catch (e) {
      notify('error', parseError(e).message);
      await get().loadUpdateState();
    } finally {
      set({ checking: false });
    }
  },

  saveSettings: async (autoCheck, mirrorURL) => {
    set({ savingSettings: true });
    try {
      const st = await api.saveUpdateSettings(autoCheck, mirrorURL);
      set({ state: st });
      notify('success', '更新设置已保存');
      return true;
    } catch (e) {
      notify('error', parseError(e).message);
      return false;
    } finally {
      set({ savingSettings: false });
    }
  },

  skipVersion: async (version) => {
    try {
      const st = await api.skipUpdateVersion(version);
      set({ state: st, modalOpen: false });
      notify('info', `已跳过 v${version}，下次手动检查仍可见`);
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  requestInstall: async () => {
    try {
      const st = await api.requestInstallUpdate();
      set({ state: st });
      if (st.status === 'waiting_idle') {
        notify('info', '已预约更新：当前任务与托管进程全部结束后将自动重启更新');
      }
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  cancelDeferred: async () => {
    const st = await api.cancelDeferredUpdate();
    if (st) set({ state: st });
  },

  dismissUpdatedNotice: async () => {
    await api.dismissUpdatedNotice();
    const st = await api.getUpdateState();
    if (st) set({ state: st });
  },
}));