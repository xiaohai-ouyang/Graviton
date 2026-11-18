import { create } from 'zustand';
import { api } from '../services/api';

export type Theme = 'system' | 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  initTheme: () => () => void;
}

function getStoredTheme(): Theme {
  try {
    const saved = localStorage.getItem('codetool_theme');
    if (saved === 'system' || saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Fallback if localStorage is inaccessible
  }
  return 'system';
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyThemeToDOM(resolved: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
  }
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialTheme = getStoredTheme();
  const initialResolved = initialTheme === 'system' ? getSystemTheme() : initialTheme;

  return {
    theme: initialTheme,
    resolvedTheme: initialResolved,
    setTheme: (theme: Theme) => {
      try {
        localStorage.setItem('codetool_theme', theme);
      } catch {
        // Ignored
      }
      const resolved = theme === 'system' ? getSystemTheme() : theme;
      applyThemeToDOM(resolved);
      set({ theme, resolvedTheme: resolved });
      void api.syncTheme(resolved);
    },
    initTheme: () => {
      const theme = getStoredTheme();
      const resolved = theme === 'system' ? getSystemTheme() : theme;
      applyThemeToDOM(resolved);
      set({ theme, resolvedTheme: resolved });
      void api.syncTheme(resolved);

      if (typeof window === 'undefined' || !window.matchMedia) {
        return () => {};
      }

      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        if (get().theme === 'system') {
          const sysTheme = e.matches ? 'dark' : 'light';
          applyThemeToDOM(sysTheme);
          set({ resolvedTheme: sysTheme });
          void api.syncTheme(sysTheme);
        }
      };

      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    },
  };
});
