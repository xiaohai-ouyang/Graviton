import * as WailsApp from '../../wailsjs/go/main/App';
import { AccountDisplay, BatchRefreshResult, SwitchResult, ApiError } from '../types';

export function parseError(err: unknown): ApiError {
  if (typeof err === 'string') {
    // Check if format is "[CODE] Message"
    const match = err.match(/^\[([A-Z_]+)\]\s*(.*)$/);
    if (match) {
      return { code: match[1], message: match[2] };
    }
    return { code: 'UNKNOWN_ERROR', message: err };
  }
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.code === 'string' && typeof e.message === 'string') {
      return { code: e.code, message: e.message };
    }
    if (typeof e.message === 'string') {
      return parseError(e.message);
    }
  }
  return { code: 'UNKNOWN_ERROR', message: String(err) };
}

export const api = {
  async listAccounts(): Promise<AccountDisplay[]> {
    try {
      return await WailsApp.ListAccounts();
    } catch (e) {
      throw parseError(e);
    }
  },

  async captureCurrentAccount(): Promise<AccountDisplay> {
    try {
      return await WailsApp.CaptureCurrentAccount();
    } catch (e) {
      throw parseError(e);
    }
  },

  async refreshAccountQuota(id: string): Promise<AccountDisplay> {
    try {
      return await WailsApp.RefreshAccountQuota(id);
    } catch (e) {
      throw parseError(e);
    }
  },

  async refreshAllQuotas(): Promise<BatchRefreshResult[]> {
    try {
      return await WailsApp.RefreshAllQuotas();
    } catch (e) {
      throw parseError(e);
    }
  },

  async switchAccount(id: string): Promise<SwitchResult> {
    try {
      return await WailsApp.SwitchAccount(id);
    } catch (e) {
      throw parseError(e);
    }
  },

  async deleteAccount(id: string): Promise<void> {
    try {
      await WailsApp.DeleteAccount(id);
    } catch (e) {
      throw parseError(e);
    }
  },

  async selectClientPath(): Promise<string> {
    try {
      return await WailsApp.SelectClientPath();
    } catch (e) {
      throw parseError(e);
    }
  },

  async getClientPath(): Promise<string> {
    try {
      return await WailsApp.GetClientPath();
    } catch (e) {
      throw parseError(e);
    }
  },
};
