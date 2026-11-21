import { create } from 'zustand';
import { api } from '../services/api';
import { ResetTimeFormat } from '../utils/quota';

const STORAGE_KEY = 'graviton_reset_time_format';

interface ResetTimeState {
  resetTimeFormat: ResetTimeFormat;
  setResetTimeFormat: (format: ResetTimeFormat) => void;
  initResetTimeFormat: () => () => void;
}

function getStoredResetTimeFormat(): ResetTimeFormat {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'countdown' || saved === 'absolute') {
      return saved;
    }
  } catch {
    // Fallback if localStorage is inaccessible
  }
  return 'countdown';
}

export const useResetTimeStore = create<ResetTimeState>((set) => {
  const initialFormat = getStoredResetTimeFormat();

  return {
    resetTimeFormat: initialFormat,
    setResetTimeFormat: (format: ResetTimeFormat) => {
      try {
        localStorage.setItem(STORAGE_KEY, format);
      } catch {
        // Ignore storage write errors
      }
      set({ resetTimeFormat: format });
      void api.syncResetTimeFormat(format);
    },
    initResetTimeFormat: () => {
      const format = getStoredResetTimeFormat();
      set({ resetTimeFormat: format });
      void api.syncResetTimeFormat(format);

      if (typeof window === 'undefined') {
        return () => {};
      }

      const handleStorage = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) {
          const nextFormat = getStoredResetTimeFormat();
          set({ resetTimeFormat: nextFormat });
          void api.syncResetTimeFormat(nextFormat);
        }
      };

      window.addEventListener('storage', handleStorage);
      return () => window.removeEventListener('storage', handleStorage);
    },
  };
});
