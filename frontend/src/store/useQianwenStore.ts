import { create } from 'zustand';
import { qianwen } from '../../wailsjs/go/models';
import { api, parseError } from '../services/api';
import { QianwenAccountDisplay, QianwenBatchRefreshResult } from '../types';
import { useAccountStore } from './useAccountStore';

interface RefreshProgress {
  completed: number;
  total: number;
}

interface QianwenState {
  accounts: QianwenAccountDisplay[];
  hasLoaded: boolean;
  loading: boolean;
  refreshingAll: boolean;
  refreshProgress: RefreshProgress | null;
  refreshingIds: Record<string, boolean>;
  deletingAccount: QianwenAccountDisplay | null;

  loadAccounts: () => Promise<void>;
  refreshAccount: (id: string) => Promise<void>;
  refreshAllAccounts: () => Promise<void>;
  applyQuotaProgress: (result: QianwenBatchRefreshResult) => void;
  confirmDeleteAccount: (account: QianwenAccountDisplay) => void;
  cancelDeleteAccount: () => void;
  executeDeleteAccount: () => Promise<void>;
}

export const useQianwenStore = create<QianwenState>((set, get) => ({
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
      const accounts = await api.listQianwenAccounts();
      set({ accounts, hasLoaded: true, loading: false });
    } catch (e) {
      const err = parseError(e);
      set({ hasLoaded: true, loading: false });
      useAccountStore.getState().setBanner({
        type: 'error',
        message: `加载千问账号列表失败: ${err.message}`,
      });
    }
  },

  refreshAccount: async (id: string) => {
    set((state) => ({
      refreshingIds: { ...state.refreshingIds, [id]: true },
    }));
    try {
      const updated = await api.refreshQianwenAccount(id);
      set((state) => ({
        accounts: state.accounts.map((acc) =>
          acc.id === id ? qianwen.AccountDisplay.createFrom(updated) : acc
        ),
        refreshingIds: { ...state.refreshingIds, [id]: false },
      }));
      useAccountStore.getState().setBanner({
        type: 'success',
        message: `千问账号 ${updated.name || updated.email || updated.aliyunId || id} 额度已更新`,
      });
    } catch (e) {
      const err = parseError(e);
      set((state) => ({
        refreshingIds: { ...state.refreshingIds, [id]: false },
      }));
      // Reload to reflect AuthExpired flag if backend marked it expired
      void get().loadAccounts();
      useAccountStore.getState().setBanner({
        type: 'error',
        message: `刷新千问额度失败: ${err.message}`,
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
      message: `正在刷新千问账号额度 (0/${total})...`,
    });

    try {
      const results = await api.refreshAllQianwenAccounts();
      const accounts = await api.listQianwenAccounts();
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.length - successCount;

      let msg = `千问额度刷新完成: ${successCount} 个成功`;
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
        message: `批量刷新千问额度失败: ${err.message}`,
      });
    }
  },

  applyQuotaProgress: (result: QianwenBatchRefreshResult) => {
    if (!result || !result.accountId) return;
    set((state) => {
      const nextAccounts = result.account
        ? state.accounts.map((acc) =>
            acc.id === result.accountId
              ? qianwen.AccountDisplay.createFrom(result.account)
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

    const label = account.name || account.email || account.aliyunId || account.id;
    set({ deletingAccount: null });
    try {
      await api.deleteQianwenAccount(account.id);
      const accounts = await api.listQianwenAccounts();
      set({ accounts });
      useAccountStore.getState().setBanner({
        type: 'success',
        message: `已移除千问账号及本地凭据: ${label}`,
      });
    } catch (e) {
      const err = parseError(e);
      useAccountStore.getState().setBanner({
        type: 'error',
        message: `移除千问账号失败: ${err.message}`,
      });
    }
  },
}));
