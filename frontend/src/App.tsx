import React, { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { EventsOn } from '../wailsjs/runtime/runtime';
import { BatchRefreshResult } from './types';
import { useAccountStore } from './store/useAccountStore';
import { useAppInfoStore } from './store/useAppInfoStore';
import { useThemeStore } from './store/useThemeStore';
import { Sidebar } from './components/Sidebar';
import { FeedbackBanner } from './components/FeedbackBanner';
import { ChangelogModal } from './components/ChangelogModal';
import { QuotaPage } from './pages/QuotaPage';
import { EnvironmentPage } from './pages/EnvironmentPage';
import { SettingsPage } from './pages/SettingsPage';

export const App: React.FC = () => {
  const { loadAccounts, loadWidgetStatus, setWidgetOpen } = useAccountStore();
  const loadAppInfo = useAppInfoStore((s) => s.loadAppInfo);
  const initTheme = useThemeStore((s) => s.initTheme);

  useEffect(() => {
    loadAccounts();
    loadWidgetStatus();
    void loadAppInfo();
    const cleanupTheme = initTheme();
    const offAccounts = EventsOn('accounts:updated', () => {
      void useAccountStore.getState().loadAccounts();
    });
    const offQuotaProgress = EventsOn('accounts:quota_progress', (result: BatchRefreshResult) => {
      useAccountStore.getState().applyQuotaProgress(result);
    });
    const offWidget = EventsOn('widget:status', (open: boolean) => {
      setWidgetOpen(Boolean(open));
    });
    return () => {
      cleanupTheme();
      offAccounts();
      offQuotaProgress();
      offWidget();
    };
  }, [loadAccounts, loadWidgetStatus, loadAppInfo, initTheme, setWidgetOpen]);

  return (
    <HashRouter>
      <div className="flex min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        <Sidebar />
        <ChangelogModal />

        <div className="flex min-w-0 flex-1 flex-col">
          <FeedbackBanner />
          <Routes>
            <Route path="/" element={<Navigate to="/quota" replace />} />
            <Route path="/quota" element={<QuotaPage />} />
            <Route path="/env" element={<EnvironmentPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/quota" replace />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  );
};

export default App;
