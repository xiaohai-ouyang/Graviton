import { create } from 'zustand';
import { api, parseError } from '../services/api';
import { UpdateState } from '../types';
import { useAccountStore } from './useAccountStore';
import { useAppInfoStore } from './useAppInfoStore';

interface UpdateStoreState {
  state: UpdateState | null;
  modalOpen: boolean;
  promptedReadyVersion: string | null;
  promptedInstalledVersion: string | null;
  notifiedUpdatedVersion: string | null;
  checking: boolean;
  savingSettings: boolean;

  loadUpdateState: () => Promise<void>;
  applyUpdateState: (next: UpdateState) => void;
  setModalOpen: (open: boolean) => void;
  checkForUpdates: () => Promise<void>;
  saveSettings: (autoCheck: boolean, mirrorURL: string) => Promise<boolean>;
  skipVersion: (version: string) => Promise<void>;
  installUpdate: () => Promise<void>;
  restartToApply: () => Promise<void>;
  cancelDeferred: () => Promise<void>;
}

const notify = (type: 'success' | 'error' | 'info', message: string) => {
  useAccountStore.getState().setBanner({ type, message });
};

export const useUpdateStore = create<UpdateStoreState>((set, get) => ({
  state: null,
  modalOpen: false,
  promptedReadyVersion: null,
  promptedInstalledVersion: null,
  notifiedUpdatedVersion: null,
  checking: false,
  savingSettings: false,

  loadUpdateState: async () => {
    const st = await api.getUpdateState();
    if (st) get().applyUpdateState(st);
  },

  applyUpdateState: (next) => {
    const { promptedReadyVersion, promptedInstalledVersion, notifiedUpdatedVersion } = get();
    const patch: Partial<UpdateStoreState> = { state: next };
    // First ready offer for a version in this session: open modal to offer "立即安装".
    if (
      next.status === 'ready' &&
      next.latestVersion &&
      next.latestVersion !== promptedReadyVersion
    ) {
      patch.promptedReadyVersion = next.latestVersion;
      patch.modalOpen = true;
    }
    // Once installation completes, prompt the user to restart.
    if (
      next.status === 'installed' &&
      next.latestVersion &&
      next.latestVersion !== promptedInstalledVersion
    ) {
      patch.promptedInstalledVersion = next.latestVersion;
      patch.modalOpen = true;
    }
    const shouldNotifyUpdated = Boolean(
      next.updatedFromVersion && next.currentVersion !== notifiedUpdatedVersion,
    );
    if (shouldNotifyUpdated) patch.notifiedUpdatedVersion = next.currentVersion;
    set(patch);
    if (shouldNotifyUpdated) {
      useAccountStore.getState().setBanner({
        type: 'success',
        message: `Graviton 已成功更新至 v${next.currentVersion}`,
        action: {
          label: '查看更新日志',
          onClick: useAppInfoStore.getState().openChangelog,
        },
      });
      void api.dismissUpdatedNotice();
    }
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

  installUpdate: async () => {
    try {
      const st = await api.installUpdate();
      get().applyUpdateState(st);
    } catch (e) {
      const parsed = parseError(e);
      notify(parsed.code === 'UPDATE_INSTALL_CANCELLED' ? 'info' : 'error', parsed.message);
      await get().loadUpdateState();
    }
  },

  restartToApply: async () => {
    try {
      const st = await api.restartToApplyUpdate();
      set({ state: st });
      if (st.status === 'waiting_idle') {
        notify('info', '已预约重启：当前任务与托管进程全部结束后将自动重启应用');
      }
    } catch (e) {
      notify('error', parseError(e).message);
    }
  },

  cancelDeferred: async () => {
    const st = await api.cancelDeferredUpdate();
    if (st) set({ state: st });
  },
}));
