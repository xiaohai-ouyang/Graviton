import React, { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { EventsOn } from '../wailsjs/runtime/runtime';
import { BatchRefreshResult, UpdateState } from './types';
import { useAccountStore } from './store/useAccountStore';
import { useAppInfoStore } from './store/useAppInfoStore';
import { useMotionStore } from './store/useMotionStore';
import { useResetTimeStore } from './store/useResetTimeStore';
import { useThemeStore } from './store/useThemeStore';
import { useUpdateStore } from './store/useUpdateStore';
import { Sidebar } from './components/Sidebar';
import { FeedbackBanner } from './components/FeedbackBanner';
import { ChangelogModal } from './components/ChangelogModal';
import { UpdateModal } from './components/UpdateModal';
import { UpdateStatusBar } from './components/UpdateStatusBar';
import { QuotaPage } from './pages/QuotaPage';
import { EnvironmentPage } from './pages/EnvironmentPage';
import { SettingsPage } from './pages/SettingsPage';

const AnimatedRoutes: React.FC = () => {
  const location = useLocation();
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={shouldAnimate ? { opacity: 0, y: 4 } : false}
        animate={{ opacity: 1, y: 0 }}
        exit={shouldAnimate ? { opacity: 0, y: -3 } : { opacity: 1 }}
        transition={
          shouldAnimate
            ? { duration: 0.14, ease: [0.22, 1, 0.36, 1] }
            : { duration: 0 }
        }
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <Routes location={location}>
          <Route path="/" element={<Navigate to="/quota" replace />} />
          <Route path="/quota" element={<QuotaPage />} />
          <Route path="/env" element={<EnvironmentPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/quota" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
};

export const App: React.FC = () => {
  const { loadAccounts, loadWidgetStatus, setWidgetOpen } = useAccountStore();
  const loadAppInfo = useAppInfoStore((s) => s.loadAppInfo);
  const initTheme = useThemeStore((s) => s.initTheme);
  const initMotion = useMotionStore((s) => s.initMotion);
  const initResetTimeFormat = useResetTimeStore((s) => s.initResetTimeFormat);
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  useEffect(() => {
    loadAccounts();
    loadWidgetStatus();
    void loadAppInfo();
    const cleanupTheme = initTheme();
    const cleanupMotion = initMotion();
    const cleanupResetTimeFormat = initResetTimeFormat();
    const offAccounts = EventsOn('accounts:updated', () => {
      void useAccountStore.getState().loadAccounts();
    });
    const offQuotaProgress = EventsOn('accounts:quota_progress', (result: BatchRefreshResult) => {
      useAccountStore.getState().applyQuotaProgress(result);
    });
    const offWidget = EventsOn('widget:status', (open: boolean) => {
      setWidgetOpen(Boolean(open));
    });
    void useUpdateStore.getState().loadUpdateState();
    const offUpdate = EventsOn('update:state', (st: UpdateState) => {
      useUpdateStore.getState().applyUpdateState(st);
    });
    return () => {
      cleanupTheme();
      cleanupMotion();
      cleanupResetTimeFormat();
      offAccounts();
      offQuotaProgress();
      offWidget();
      offUpdate();
    };
  }, [
    loadAccounts,
    loadWidgetStatus,
    loadAppInfo,
    initTheme,
    initMotion,
    initResetTimeFormat,
    setWidgetOpen,
  ]);

  return (
    <MotionConfig reducedMotion={shouldAnimate ? 'never' : 'always'}>
      <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
        <HashRouter>
          <div className="flex min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
            <Sidebar />
            <ChangelogModal />
            <UpdateModal />

            <div className="flex min-w-0 flex-1 flex-col">
              <FeedbackBanner />
              <UpdateStatusBar />
              <AnimatedRoutes />
            </div>
          </div>
        </HashRouter>
      </Tooltip.Provider>
    </MotionConfig>
  );
};

export default App;
