import React, { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { EventsOn } from '../wailsjs/runtime/runtime';
import { BatchRefreshResult, QianwenBatchRefreshResult, UpdateState } from './types';
import { useAccountStore } from './store/useAccountStore';
import { useAppInfoStore } from './store/useAppInfoStore';
import { useMotionStore } from './store/useMotionStore';
import { useQianwenStore } from './store/useQianwenStore';
import { useResetTimeStore } from './store/useResetTimeStore';
import {
  BackgroundLocationSnapshot,
  getBackgroundLocation,
  isEmptyQuotaPath,
  isSettingsPath,
  resolveSafeQuotaFallback,
  SettingsRouteState,
  useSettingsModalStore,
} from './store/useSettingsModalStore';
import { useThemeStore } from './store/useThemeStore';
import { useUpdateStore } from './store/useUpdateStore';
import { hasOtherDialogOpen } from './utils/dialog';
import { Sidebar } from './components/Sidebar';
import { FeedbackBanner } from './components/FeedbackBanner';
import { ChangelogModal } from './components/ChangelogModal';
import { DeleteConfirmModal } from './components/DeleteConfirmModal';
import { QianwenDeleteConfirmModal } from './components/QianwenDeleteConfirmModal';
import { UpdateModal } from './components/UpdateModal';
import { UpdateStatusBar } from './components/UpdateStatusBar';
import { SettingsModal } from './components/settings/SettingsModal';
import { OverviewPage } from './pages/OverviewPage';
import { QuotaPage } from './pages/QuotaPage';
import { QianwenQuotaPage } from './pages/QianwenQuotaPage';
import { EnvironmentPage } from './pages/EnvironmentPage';

interface AnimatedRoutesProps {
  backgroundLocation: BackgroundLocationSnapshot;
}

/** /quota index redirect that waits for both provider stores before choosing a target. */
const QuotaIndexRedirect: React.FC = () => {
  const agCount = useAccountStore((s) => s.accounts.length);
  const agHasLoaded = useAccountStore((s) => s.hasLoaded);
  const qwCount = useQianwenStore((s) => s.accounts.length);
  const qwHasLoaded = useQianwenStore((s) => s.hasLoaded);

  if (!agHasLoaded || !qwHasLoaded) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-neutral-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-800 dark:border-neutral-700 dark:border-t-neutral-200" />
        <p className="text-xs">正在加载额度数据...</p>
      </div>
    );
  }

  return <Navigate to={resolveSafeQuotaFallback(agCount, qwCount)} replace />;
};

const AnimatedRoutes: React.FC<AnimatedRoutesProps> = ({ backgroundLocation }) => {
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={backgroundLocation.pathname}
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
        <Routes location={backgroundLocation}>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/quota" element={<QuotaIndexRedirect />} />
          <Route path="/quota/antigravity" element={<QuotaPage />} />
          <Route path="/quota/qianwen" element={<QianwenQuotaPage />} />
          <Route path="/env" element={<EnvironmentPage />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
};

const AppShell: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const backgroundLocation = getBackgroundLocation(location);
  const settingsOpen = isSettingsPath(location.pathname);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const isCommaShortcut =
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key === ',' || e.code === 'Comma');
      if (!isCommaShortcut) return;

      if (settingsOpen) {
        if (
          useAppInfoStore.getState().changelogOpen ||
          useUpdateStore.getState().modalOpen ||
          hasOtherDialogOpen(true)
        ) {
          return;
        }
        e.preventDefault();
        const agState = useAccountStore.getState();
        const qwState = useQianwenStore.getState();
        // Background quota page may have been emptied while settings was open
        if (
          isEmptyQuotaPath(
            backgroundLocation.pathname,
            agState.accounts.length,
            agState.hasLoaded,
            qwState.accounts.length,
            qwState.hasLoaded
          )
        ) {
          navigate(
            resolveSafeQuotaFallback(agState.accounts.length, qwState.accounts.length),
            { replace: true }
          );
          return;
        }
        const routeState = location.state as SettingsRouteState | null | undefined;
        if (routeState?.fromModalTrigger) {
          navigate(-1);
        } else {
          navigate(
            `${backgroundLocation.pathname}${backgroundLocation.search}${backgroundLocation.hash}`,
            { replace: true }
          );
        }
        return;
      }

      if (
        useAppInfoStore.getState().changelogOpen ||
        useUpdateStore.getState().modalOpen ||
        hasOtherDialogOpen(false)
      ) {
        return;
      }

      e.preventDefault();
      const targetSection = useSettingsModalStore.getState().lastSection;
      navigate(`/settings/${targetSection}`, {
        state: {
          backgroundLocation,
          fromModalTrigger: true,
        } satisfies SettingsRouteState,
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen, location.state, backgroundLocation, navigate]);

  return (
    <div className="flex min-h-screen bg-neutral-50 text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <UpdateStatusBar />
        <AnimatedRoutes backgroundLocation={backgroundLocation} />
      </div>

      <SettingsModal />
      <DeleteConfirmModal />
      <QianwenDeleteConfirmModal />
      <ChangelogModal />
      <UpdateModal />
      <FeedbackBanner />
    </div>
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
    void useQianwenStore.getState().loadAccounts();
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
    const offQianwenUpdated = EventsOn('qianwen:updated', () => {
      void useQianwenStore.getState().loadAccounts();
    });
    const offQianwenProgress = EventsOn(
      'qianwen:quota_progress',
      (result: QianwenBatchRefreshResult) => {
        useQianwenStore.getState().applyQuotaProgress(result);
      }
    );
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
      offQianwenUpdated();
      offQianwenProgress();
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
          <AppShell />
        </HashRouter>
      </Tooltip.Provider>
    </MotionConfig>
  );
};

export default App;
