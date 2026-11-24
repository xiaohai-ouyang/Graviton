import { create } from 'zustand';
import { appservice } from '../../wailsjs/go/models';
import { AccountDisplay, BatchRefreshResult } from '../types';
import { api, parseError } from '../services/api';

interface FeedbackBanner {
  type: 'success' | 'error' | 'info';
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface RefreshProgress {
  completed: number;
  total: number;
}

interface AccountState {
  accounts: AccountDisplay[];
  hasLoaded: boolean;
  loading: boolean;
  capturing: boolean;
  refreshingAll: boolean;
  refreshProgress: RefreshProgress | null;
  refreshingIds: Record<string, boolean>;
  switchingIds: Record<string, boolean>;
  deletingAccount: AccountDisplay | null;
  clientPath: string;
  banner: FeedbackBanner | null;
  expandedIds: Record<string, boolean>;
  widgetOpen: boolean;
  widgetAlwaysOnTop: boolean;

  loadAccounts: () => Promise<void>;
  captureCurrentAccount: () => Promise<void>;
  refreshAccountQuota: (id: string) => Promise<void>;
  refreshAllQuotas: () => Promise<void>;
  applyQuotaProgress: (result: BatchRefreshResult) => void;
  switchAccount: (id: string) => Promise<void>;
  confirmDeleteAccount: (account: AccountDisplay) => void;
  cancelDeleteAccount: () => void;
  executeDeleteAccount: () => Promise<void>;
  selectClientPath: () => Promise<void>;
  loadClientPath: () => Promise<void>;
  toggleExpand: (id: string) => void;
  setBanner: (banner: FeedbackBanner | null) => void;
  clearBanner: () => void;
  loadWidgetStatus: () => Promise<void>;
  toggleWidget: () => Promise<void>;
  setWidgetOpen: (open: boolean) => void;
  loadWidgetAlwaysOnTop: () => Promise<void>;
  setWidgetAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  hasLoaded: false,
  loading: false,
  capturing: false,
  refreshingAll: false,
  refreshProgress: null,
  refreshingIds: {},
  switchingIds: {},
  deletingAccount: null,
  clientPath: '',
  banner: null,
  expandedIds: {},
  widgetOpen: false,
  widgetAlwaysOnTop: false,

  loadAccounts: async () => {
    set({ loading: true });
    try {
      const accounts = await api.listAccounts();
      set({ accounts, hasLoaded: true, loading: false });
    } catch (e) {
      const err = parseError(e);
      set({
        hasLoaded: true,
        loading: false,
        banner: { type: 'error', message: `加载账号列表失败: ${err.message}` },
      });
    }
  },

  captureCurrentAccount: async () => {
    set({ capturing: true, banner: { type: 'info', message: '正在读取本机登录账号并验证凭据...' } });
    try {
      const captured = await api.captureCurrentAccount();
      const accounts = await api.listAccounts();
      set({
        accounts,
        capturing: false,
        banner: { type: 'success', message: `成功收录账号: ${captured.email}` },
      });
    } catch (e) {
      const err = parseError(e);
      set({
        capturing: false,
        banner: { type: 'error', message: `收录当前账号失败: ${err.message}` },
      });
    }
  },

  refreshAccountQuota: async (id: string) => {
    set((state) => ({
      refreshingIds: { ...state.refreshingIds, [id]: true },
    }));
    try {
      const updated = await api.refreshAccountQuota(id);
      set((state) => ({
        accounts: state.accounts.map((acc) =>
          acc.id === id
            ? appservice.AccountDisplay.createFrom({ ...updated, isCurrent: acc.isCurrent })
            : acc
        ),
        refreshingIds: { ...state.refreshingIds, [id]: false },
        banner: { type: 'success', message: `账号 ${updated.email} 额度已更新` },
      }));
    } catch (e) {
      const err = parseError(e);
      set((state) => ({
        refreshingIds: { ...state.refreshingIds, [id]: false },
        banner: { type: 'error', message: `刷新额度失败: ${err.message}` },
      }));
    }
  },

  refreshAllQuotas: async () => {
    const currentAccounts = get().accounts;
    const total = currentAccounts.length;
    const initialRefreshingIds: Record<string, boolean> = {};
    for (const acc of currentAccounts) {
      initialRefreshingIds[acc.id] = true;
    }

    set({
      refreshingAll: true,
      refreshProgress: total > 0 ? { completed: 0, total } : null,
      refreshingIds: initialRefreshingIds,
      banner: {
        type: 'info',
        message:
          total > 0
            ? `正在并发刷新全部账号额度 (0/${total})...`
            : '正在并发刷新全部账号额度...',
      },
    });
    try {
      const results = await api.refreshAllQuotas();
      const accounts = await api.listAccounts();
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.length - successCount;

      let msg = `已完成全部刷新: ${successCount} 个成功`;
      if (failCount > 0) {
        msg += `，${failCount} 个遇到异常（已保留上次快照）`;
      }

      set({
        accounts,
        refreshingAll: false,
        refreshProgress: null,
        refreshingIds: {},
        banner: { type: failCount > 0 ? 'info' : 'success', message: msg },
      });
    } catch (e) {
      const err = parseError(e);
      set({
        refreshingAll: false,
        refreshProgress: null,
        refreshingIds: {},
        banner: { type: 'error', message: `批量刷新失败: ${err.message}` },
      });
    }
  },

  applyQuotaProgress: (result: BatchRefreshResult) => {
    if (!result || !result.accountId || !result.account) {
      return;
    }
    set((state) => {
      const nextAccounts = state.accounts.map((acc) => {
        if (acc.id !== result.accountId) return acc;
        return appservice.AccountDisplay.createFrom({
          ...result.account,
          isCurrent: result.account.isCurrent ?? acc.isCurrent,
        });
      });

      const nextRefreshingIds = {
        ...state.refreshingIds,
        [result.accountId]: false,
      };

      if (state.refreshingAll && state.refreshProgress) {
        const completed = Math.min(
          state.refreshProgress.total,
          state.refreshProgress.completed + 1
        );
        const total = state.refreshProgress.total;
        return {
          accounts: nextAccounts,
          refreshingIds: nextRefreshingIds,
          refreshProgress: { completed, total },
          banner: {
            type: 'info',
            message: `正在并发刷新全部账号额度 (${completed}/${total})...`,
          },
        };
      }

      return {
        accounts: nextAccounts,
        refreshingIds: nextRefreshingIds,
      };
    });
  },

  switchAccount: async (id: string) => {
    const acc = get().accounts.find((a) => a.id === id);
    const email = acc ? acc.email : id;
    set((state) => ({
      switchingIds: { ...state.switchingIds, [id]: true },
      banner: { type: 'info', message: `正在切换至账号 ${email}...` },
    }));

    try {
      const res = await api.switchAccount(id);
      const accounts = await api.listAccounts();
      set((state) => ({
        accounts,
        switchingIds: { ...state.switchingIds, [id]: false },
        banner: { type: 'success', message: `${res.message} (${email})` },
      }));
    } catch (e) {
      const err = parseError(e);
      set((state) => ({
        switchingIds: { ...state.switchingIds, [id]: false },
        banner: { type: 'error', message: `切换账号失败: ${err.message}` },
      }));
    }
  },

  confirmDeleteAccount: (account: AccountDisplay) => {
    set({ deletingAccount: account });
  },

  cancelDeleteAccount: () => {
    set({ deletingAccount: null });
  },

  executeDeleteAccount: async () => {
    const account = get().deletingAccount;
    if (!account) return;

    const email = account.email;
    set({ deletingAccount: null });
    try {
      await api.deleteAccount(account.id);
      const accounts = await api.listAccounts();
      set({
        accounts,
        banner: { type: 'success', message: `已成功删除账号记录与独立凭据: ${email}` },
      });
    } catch (e) {
      const err = parseError(e);
      set({
        banner: { type: 'error', message: `删除失败: ${err.message}` },
      });
    }
  },

  selectClientPath: async () => {
    try {
      const selected = await api.selectClientPath();
      if (selected) {
        set({
          clientPath: selected,
          banner: { type: 'success', message: `已保存客户端路径: ${selected}` },
        });
      }
    } catch (e) {
      const err = parseError(e);
      set({ banner: { type: 'error', message: `选择客户端路径失败: ${err.message}` } });
    }
  },

  loadClientPath: async () => {
    try {
      const path = await api.getClientPath();
      set({ clientPath: path });
    } catch {
      // Ignored
    }
  },

  toggleExpand: (id: string) => {
    set((state) => ({
      expandedIds: {
        ...state.expandedIds,
        [id]: !state.expandedIds[id],
      },
    }));
  },

  setBanner: (banner) => set({ banner }),
  clearBanner: () => set({ banner: null }),
  loadWidgetStatus: async () => {
    const open = await api.isWidgetOpen();
    set({ widgetOpen: open });
  },
  toggleWidget: async () => {
    try {
      const open = await api.toggleWidget();
      set({ widgetOpen: open });
    } catch (e) {
      const err = parseError(e);
      set({ banner: { type: 'error', message: `切换悬浮窗失败: ${err.message}` } });
    }
  },
  setWidgetOpen: (open: boolean) => set({ widgetOpen: open }),
  loadWidgetAlwaysOnTop: async () => {
    const alwaysOnTop = await api.getWidgetAlwaysOnTop();
    set({ widgetAlwaysOnTop: alwaysOnTop });
  },
  setWidgetAlwaysOnTop: async (alwaysOnTop: boolean) => {
    set({ widgetAlwaysOnTop: alwaysOnTop });
    try {
      await api.setWidgetAlwaysOnTop(alwaysOnTop);
    } catch (e) {
      const err = parseError(e);
      set({
        widgetAlwaysOnTop: !alwaysOnTop,
        banner: { type: 'error', message: `保存悬浮窗置顶设置失败: ${err.message}` },
      });
    }
  },
}));
