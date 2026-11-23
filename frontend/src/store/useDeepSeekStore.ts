import { create } from 'zustand';
import { deepseek } from '../../wailsjs/go/models';
import { api, parseError } from '../services/api';
import { DeepSeekAccountDisplay, DeepSeekBatchRefreshResult } from '../types';
import { useAccountStore } from './useAccountStore';

interface RefreshProgress {
  completed: number;
  total: number;
}

interface DeepSeekState {
  accounts: DeepSeekAccountDisplay[];
  hasLoaded: boolean;
  loading: boolean;
  refreshingAll: boolean;
  refreshProgress: RefreshProgress | null;
  refreshingIds: Record<string, boolean>;
  deletingAccount: DeepSeekAccountDisplay | null;

  loadAccounts: () => Promise<void>;
  refreshAccount: (id: string) => Promise<void>;
  refreshAllAccounts: () => Promise<void>;
  applyQuotaProgress: (result: DeepSeekBatchRefreshResult) => void;
  confirmDeleteAccount: (account: DeepSeekAccountDisplay) => void;
  cancelDeleteAccount: () => void;
  executeDeleteAccount: () => Promise<void>;
}

export const useDeepSeekStore = create<DeepSeekState>((set, get) => ({
  accounts: [],
  hasLoaded: false,
  loading: false,
  refreshingAll: false,
  refreshProgress: null,
  refreshingIds: {},
  deletingAccount: null,

  loadAccounts: async () => {
    set({ loading: true });
    try {
      const accounts = await api.listDeepSeekAccounts();
      set({ accounts, hasLoaded: true, loading: false });
    } catch (e) {
      const err = parseError(e);
      set({ hasLoaded: true, loading: false });
      useAccountStore.getState().setBanner({
        type: 'error',
        message: `加载 DeepSeek 账号列表失败: ${err.message}`,
      });
    }
  },

  refreshAccount: async (id: string) => {
    set((state) => ({
      refreshingIds: { ...state.refreshingIds, [id]: true },
    }));
    try {
      const updated = await api.refreshDeepSeekAccount(id);
      set((state) => ({
        accounts: state.accounts.map((acc) =>
          acc.id === id ? deepseek.AccountDisplay.createFrom(updated) : acc
        ),
        refreshingIds: { ...state.refreshingIds, [id]: false },
      }));
      useAccountStore.getState().setBanner({
        type: 'success',
        message: `DeepSeek 账号 ${updated.name || updated.keyPreview || id} 余额已更新`,
      });
    } catch (e) {
      const err = parseError(e);
      set((state) => ({
        refreshingIds: { ...state.refreshingIds, [id]: false },
      }));
      // Reload to reflect AuthInvalid / ErrorMessage persisted by backend
      void get().loadAccounts();
      useAccountStore.getState().setBanner({
        type: 'error',
        message: `刷新 DeepSeek 余额失败: ${err.message}`,
      });
    }
  },

  refreshAllAccounts: async () => {
    const currentAccounts = get().accounts;
    if (currentAccounts.length === 0) return;

    const total = currentAccounts.length;
    const initialRefreshingIds: Record<string, boolean> = {};
    for (const acc of currentAccounts) {
      initialRefreshingIds[acc.id] = true;
    }

    set({
      refreshingAll: true,
      refreshProgress: { completed: 0, total },
      refreshingIds: initialRefreshingIds,
    });
    useAccountStore.getState().setBanner({
      type: 'info',
      message: `正在刷新 DeepSeek 账号余额 (0/${total})...`,
    });

    try {
      const results = await api.refreshAllDeepSeekAccounts();
      const accounts = await api.listDeepSeekAccounts();
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.length - successCount;

      let msg = `DeepSeek 余额刷新完成: ${successCount} 个成功`;
      if (failCount > 0) {
        msg += `，${failCount} 个遇到异常`;
      }

      set({
        accounts,
        refreshingAll: false,
        refreshProgress: null,
        refreshingIds: {},
      });
      useAccountStore.getState().setBanner({
        type: failCount > 0 ? 'info' : 'success',
        message: msg,
      });
    } catch (e) {
      const err = parseError(e);
      set({
        refreshingAll: false,
        refreshProgress: null,
        refreshingIds: {},
      });
      useAccountStore.getState().setBanner({
        type: 'error',
        message: `批量刷新 DeepSeek 余额失败: ${err.message}`,
      });
    }
  },

  applyQuotaProgress: (result: DeepSeekBatchRefreshResult) => {
    if (!result || !result.accountId) return;
    set((state) => {
      const nextAccounts = result.account
        ? state.accounts.map((acc) =>
            acc.id === result.accountId
              ? deepseek.AccountDisplay.createFrom(result.account)
              : acc
          )
        : state.accounts;

      const nextRefreshingIds = {
        ...state.refreshingIds,
        [result.accountId]: false,
      };

      if (state.refreshingAll && state.refreshProgress) {
        const completed = Math.min(
          state.refreshProgress.total,
          state.refreshProgress.completed + 1
        );
        return {
          accounts: nextAccounts,
          refreshingIds: nextRefreshingIds,
          refreshProgress: { completed, total: state.refreshProgress.total },
        };
      }

      return {
        accounts: nextAccounts,
        refreshingIds: nextRefreshingIds,
      };
    });
  },

  confirmDeleteAccount: (account) => set({ deletingAccount: account }),
  cancelDeleteAccount: () => set({ deletingAccount: null }),

  executeDeleteAccount: async () => {
    const account = get().deletingAccount;
    if (!account) return;

    const label = account.name || account.keyPreview || account.id;
    set({ deletingAccount: null });
    try {
      await api.deleteDeepSeekAccount(account.id);
      const accounts = await api.listDeepSeekAccounts();
      set({ accounts });
      useAccountStore.getState().setBanner({
        type: 'success',
        message: `已移除 DeepSeek 账号及本地凭据: ${label}`,
      });
    } catch (e) {
      const err = parseError(e);
      useAccountStore.getState().setBanner({
        type: 'error',
        message: `移除 DeepSeek 账号失败: ${err.message}`,
      });
    }
  },
}));
