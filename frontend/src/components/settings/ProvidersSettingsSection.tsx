import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  MonitorDown,
  RefreshCw,
  Trash2,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { BrowserOpenURL, EventsOn } from '../../../wailsjs/runtime/runtime';
import { ProviderLogo } from '../ProviderLogo';
import { useNowTick } from '../../hooks/useNowTick';
import { api, parseError } from '../../services/api';
import { useAccountStore } from '../../store/useAccountStore';
import { useMotionStore } from '../../store/useMotionStore';
import { useQianwenStore } from '../../store/useQianwenStore';
import { useSettingsModalStore } from '../../store/useSettingsModalStore';
import {
  BatchImportResult,
  OAuthCompletionEvent,
  OAuthStartResult,
  QianwenAccountDisplay,
  QianwenAuthEvent,
  QianwenAuthStartResponse,
} from '../../types';
import { formatRelativeTime } from '../../utils/quota';

interface ProvidersSettingsSectionProps {
  entryHighlightClass: (id: string) => string;
  onNavigateToQuota: (path: string) => void;
}

type AddTab = 'oauth' | 'token' | 'capture';

const ADD_TABS: { id: AddTab; label: string; icon: React.ReactNode }[] = [
  { id: 'oauth', label: 'OAuth 登录', icon: <ExternalLink className="h-3.5 w-3.5" /> },
  { id: 'token', label: '导入 Token', icon: <KeyRound className="h-3.5 w-3.5" /> },
  { id: 'capture', label: '收录当前账号', icon: <MonitorDown className="h-3.5 w-3.5" /> },
];

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const ProvidersSettingsSection: React.FC<ProvidersSettingsSectionProps> = ({
  entryHighlightClass,
  onNavigateToQuota,
}) => {
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);
  const nowMs = useNowTick();

  const agAccounts = useAccountStore((s) => s.accounts);
  const agHasLoaded = useAccountStore((s) => s.hasLoaded);
  const capturing = useAccountStore((s) => s.capturing);
  const qwAccounts = useQianwenStore((s) => s.accounts);
  const qwHasLoaded = useQianwenStore((s) => s.hasLoaded);

  const pendingProviderIntent = useSettingsModalStore((s) => s.pendingProviderIntent);

  // Antigravity embedded add panel
  const [agAddOpen, setAgAddOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AddTab>('oauth');

  // OAuth state
  const [oauthSession, setOAuthSession] = useState<OAuthStartResult | null>(null);
  const [oauthStarting, setOAuthStarting] = useState(false);
  const [oauthCompleting, setOAuthCompleting] = useState(false);
  const [oauthError, setOAuthError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [manualCallbackUrl, setManualCallbackUrl] = useState('');

  // Refresh token import state
  const [tokenInput, setTokenInput] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<BatchImportResult | null>(null);

  // Qianwen embedded device-flow panel
  const [qwConnectOpen, setQwConnectOpen] = useState(false);
  const [qwReauthTarget, setQwReauthTarget] = useState<QianwenAccountDisplay | null>(null);
  const [qwSession, setQwSession] = useState<QianwenAuthStartResponse | null>(null);
  const [qwStarting, setQwStarting] = useState(false);
  const [qwPollStatus, setQwPollStatus] = useState<string>('idle');
  const [qwPollInterval, setQwPollInterval] = useState<number>(5);
  const [qwRemainingSec, setQwRemainingSec] = useState<number>(0);
  const [qwErrorMsg, setQwErrorMsg] = useState<string | null>(null);
  const [qwCopiedUrl, setQwCopiedUrl] = useState(false);
  const [qwCopiedCode, setQwCopiedCode] = useState(false);

  const oauthSessionRef = useRef<OAuthStartResult | null>(null);
  oauthSessionRef.current = oauthSession;
  const qwSessionRef = useRef<QianwenAuthStartResponse | null>(null);
  qwSessionRef.current = qwSession;
  const qwReauthTargetRef = useRef<QianwenAccountDisplay | null>(null);
  qwReauthTargetRef.current = qwReauthTarget;
  const pendingQwReauthIdRef = useRef<string | null>(null);

  // --- Antigravity OAuth session lifecycle ---

  // Cancel any in-flight OAuth session when the panel collapses or unmounts
  useEffect(() => {
    if (agAddOpen) return;
    if (oauthSessionRef.current) {
      void api.cancelOAuthLogin().catch(() => {});
      oauthSessionRef.current = null;
      setOAuthSession(null);
    }
    setOAuthError(null);
    setManualCallbackUrl('');
    setCopiedUrl(false);
    return () => {
      if (oauthSessionRef.current) {
        void api.cancelOAuthLogin().catch(() => {});
        oauthSessionRef.current = null;
      }
    };
  }, [agAddOpen]);

  // Cancel an in-flight OAuth session on unmount even while the panel stays open
  useEffect(() => {
    return () => {
      if (oauthSessionRef.current) {
        void api.cancelOAuthLogin().catch(() => {});
        oauthSessionRef.current = null;
      }
    };
  }, []);

  // Listen for asynchronous OAuth callback completion from Go backend
  useEffect(() => {
    if (!agAddOpen) return;

    const unsubscribe = EventsOn('oauth:completed', async (evt: OAuthCompletionEvent) => {
      oauthSessionRef.current = null;
      setOAuthSession(null);
      setOAuthCompleting(false);
      if (evt?.cancelled) return;
      if (evt?.error) {
        setOAuthError(evt.error);
        return;
      }
      if (evt?.account) {
        await useAccountStore.getState().loadAccounts();
        useAccountStore
          .getState()
          .setBanner({ type: 'success', message: `OAuth 登录成功: ${evt.account.email}` });
        setAgAddOpen(false);
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [agAddOpen]);

  const handleStartOAuth = async () => {
    setOAuthError(null);
    setOAuthStarting(true);
    setCopiedUrl(false);
    try {
      const res = await api.startOAuthLogin();
      oauthSessionRef.current = res;
      setOAuthSession(res);
    } catch (e) {
      setOAuthError(parseError(e).message);
    } finally {
      setOAuthStarting(false);
    }
  };

  const handleCancelOAuth = async () => {
    await api.cancelOAuthLogin().catch(() => {});
    oauthSessionRef.current = null;
    setOAuthSession(null);
    setManualCallbackUrl('');
    setOAuthError(null);
  };

  const handleCopyAuthUrl = async () => {
    if (!oauthSession?.authUrl) return;
    try {
      await navigator.clipboard.writeText(oauthSession.authUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      setOAuthError('复制链接失败，请手动全选输入框中的链接复制');
    }
  };

  const handleManualCallbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCallbackUrl.trim()) return;
    setOAuthError(null);
    setOAuthCompleting(true);
    try {
      const acc = await api.completeOAuthWithCallbackURL(manualCallbackUrl);
      oauthSessionRef.current = null;
      setOAuthSession(null);
      setManualCallbackUrl('');
      await useAccountStore.getState().loadAccounts();
      useAccountStore
        .getState()
        .setBanner({ type: 'success', message: `OAuth 登录成功: ${acc.email}` });
      setAgAddOpen(false);
    } catch (err) {
      setOAuthError(parseError(err).message);
    } finally {
      setOAuthCompleting(false);
    }
  };

  const handleImportTokens = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setImportError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const res = await api.importRefreshTokens(tokenInput);
      setImportResult(res);
      if (res.success > 0) {
        await useAccountStore.getState().loadAccounts();
        useAccountStore.getState().setBanner({
          type: res.failed > 0 ? 'info' : 'success',
          message: `Token 导入完成: ${res.success} 个成功${res.failed > 0 ? `，${res.failed} 个失败` : ''}`,
        });
      }
    } catch (err) {
      setImportError(parseError(err).message);
    } finally {
      setImporting(false);
    }
  };

  const handleCaptureCurrent = async () => {
    await useAccountStore.getState().captureCurrentAccount();
    const currentBanner = useAccountStore.getState().banner;
    if (currentBanner?.type === 'success') {
      setAgAddOpen(false);
    }
  };

  // --- Qianwen device-flow session lifecycle ---

  const resetQwLocalState = () => {
    qwSessionRef.current = null;
    setQwSession(null);
    setQwStarting(false);
    setQwPollStatus('idle');
    setQwPollInterval(5);
    setQwRemainingSec(0);
    setQwErrorMsg(null);
    setQwCopiedUrl(false);
    setQwCopiedCode(false);
  };

  // Cancel any in-flight device-flow session when the panel collapses,
  // the reauth target changes, or the component unmounts
  useEffect(() => {
    if (qwConnectOpen) return;
    if (qwSessionRef.current) {
      void api.cancelQianwenAuth().catch(() => {});
    }
    resetQwLocalState();
    return () => {
      if (qwSessionRef.current) {
        void api.cancelQianwenAuth().catch(() => {});
        qwSessionRef.current = null;
      }
    };
  }, [qwConnectOpen, qwReauthTarget]);

  // Cancel an in-flight device-flow session on unmount even while the panel stays open
  useEffect(() => {
    return () => {
      if (qwSessionRef.current) {
        void api.cancelQianwenAuth().catch(() => {});
        qwSessionRef.current = null;
      }
    };
  }, []);

  // Listen to backend device-flow polling events with a stable subscription
  useEffect(() => {
    if (!qwConnectOpen) return;

    const unsubscribe = EventsOn('qianwen:auth', async (evt: QianwenAuthEvent) => {
      if (!evt) return;
      const activeSession = qwSessionRef.current;
      if (activeSession && evt.sessionId && evt.sessionId !== activeSession.sessionId) {
        return;
      }

      if (evt.status === 'pending' || evt.status === 'slow_down' || evt.status === 'completing') {
        setQwPollStatus(evt.status);
        if (evt.interval && evt.interval > 0) {
          setQwPollInterval(evt.interval);
        }
        return;
      }

      if (evt.status === 'complete' && evt.account) {
        qwSessionRef.current = null;
        setQwSession(null);
        setQwPollStatus('idle');
        await useQianwenStore.getState().loadAccounts();
        const label =
          evt.account.name || evt.account.email || evt.account.aliyunId || '千问账号';
        useAccountStore
          .getState()
          .setBanner({ type: 'success', message: `千问账号连接成功: ${label}` });
        setQwReauthTarget(null);
        setQwConnectOpen(false);
        return;
      }

      if (evt.status === 'cancelled') {
        qwSessionRef.current = null;
        setQwSession(null);
        setQwPollStatus('idle');
        return;
      }

      if (evt.status === 'expired' || evt.status === 'denied' || evt.status === 'error') {
        qwSessionRef.current = null;
        setQwSession(null);
        setQwPollStatus(evt.status);
        setQwErrorMsg(evt.error || '授权未完成，请重试');
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [qwConnectOpen]);

  // Countdown timer while device code session is active
  const qwActiveSessionId = qwSession?.sessionId ?? '';
  useEffect(() => {
    if (!qwConnectOpen || !qwActiveSessionId) return;
    const timer = window.setInterval(() => {
      setQwRemainingSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [qwConnectOpen, qwActiveSessionId]);

  const handleStartQwAuth = async () => {
    setQwErrorMsg(null);
    setQwStarting(true);
    setQwCopiedUrl(false);
    setQwCopiedCode(false);
    try {
      const res = await api.startQianwenAuth(qwReauthTargetRef.current?.id ?? '');
      qwSessionRef.current = res;
      setQwSession(res);
      setQwPollStatus('pending');
      setQwPollInterval(res.interval || 5);
      setQwRemainingSec(res.expiresIn || 300);
    } catch (e) {
      setQwErrorMsg(parseError(e).message);
    } finally {
      setQwStarting(false);
    }
  };

  const handleCancelQwAuth = async () => {
    await api.cancelQianwenAuth().catch(() => {});
    resetQwLocalState();
  };

  const handleQwCopy = async (text: string, which: 'url' | 'code') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'url') {
        setQwCopiedUrl(true);
        setTimeout(() => setQwCopiedUrl(false), 2000);
      } else {
        setQwCopiedCode(true);
        setTimeout(() => setQwCopiedCode(false), 2000);
      }
    } catch {
      setQwErrorMsg('复制失败，请手动选中文本复制');
    }
  };

  // --- One-shot provider intent (deep link from overview / sidebar / expired card) ---

  useEffect(() => {
    if (!pendingProviderIntent) return;
    const intent = useSettingsModalStore.getState().consumePendingProviderIntent();
    if (!intent) return;

    const anchorId =
      intent.provider === 'antigravity' ? 'provider-antigravity' : 'provider-qianwen';

    if (intent.provider === 'antigravity') {
      if (intent.antigravityTab) {
        setActiveTab(intent.antigravityTab);
      }
      setAgAddOpen(true);
    } else {
      if (intent.action === 'reauth' && intent.qianwenAccountId) {
        if (qwSessionRef.current) {
          void api.cancelQianwenAuth().catch(() => {});
        }
        resetQwLocalState();
        const target =
          useQianwenStore
            .getState()
            .accounts.find((a) => a.id === intent.qianwenAccountId) ?? null;
        pendingQwReauthIdRef.current = target ? null : intent.qianwenAccountId;
        setQwReauthTarget(target);
      } else {
        pendingQwReauthIdRef.current = null;
        setQwReauthTarget(null);
      }
      setQwConnectOpen(true);
    }

    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-settings-entry-id="${anchorId}"]`
      );
      el?.scrollIntoView({ behavior: shouldAnimate ? 'smooth' : 'auto', block: 'start' });
    });
  }, [pendingProviderIntent, shouldAnimate]);

  // Resolve a pending reauth target once accounts finish loading asynchronously
  useEffect(() => {
    const pendingId = pendingQwReauthIdRef.current;
    if (!pendingId || !qwHasLoaded) return;
    const target = qwAccounts.find((a) => a.id === pendingId);
    if (target) {
      pendingQwReauthIdRef.current = null;
      setQwReauthTarget(target);
    }
  }, [qwAccounts, qwHasLoaded]);

  const openQwReauth = (account: QianwenAccountDisplay) => {
    if (qwSessionRef.current) {
      void api.cancelQianwenAuth().catch(() => {});
    }
    resetQwLocalState();
    setQwReauthTarget(account);
    setQwConnectOpen(true);
  };

  const toggleQwConnect = () => {
    if (qwConnectOpen) {
      setQwConnectOpen(false);
      setQwReauthTarget(null);
    } else {
      setQwReauthTarget(null);
      setQwConnectOpen(true);
    }
  };

  const qwReauthLabel =
    qwReauthTarget?.name || qwReauthTarget?.email || qwReauthTarget?.aliyunId;

  return (
    <>
      {/* Provider Card 1: Antigravity */}
      <section className="rounded-2xl border border-neutral-200/80 bg-card/90 p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
        <div
          data-settings-entry-id="provider-antigravity"
          className={`-m-2 p-2 transition-colors ${entryHighlightClass('provider-antigravity')}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
            <div className="flex items-center gap-2.5">
              <ProviderLogo provider="antigravity" size="md" />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    Antigravity
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      agAccounts.length > 0
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                    }`}
                  >
                    {agHasLoaded
                      ? agAccounts.length > 0
                        ? `已连接 ${agAccounts.length} 个账号`
                        : '未连接'
                      : '加载中...'}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Google Antigravity 客户端账号 · OAuth / Token 导入 / 本机收录
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {agAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigateToQuota('/quota/antigravity')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 text-xs font-medium text-neutral-700 shadow-2xs transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  <span>查看额度</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setAgAddOpen((prev) => !prev)}
                aria-expanded={agAddOpen}
                className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.98] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {agAddOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" />
                )}
                <span>{agAddOpen ? '收起' : '添加账号'}</span>
              </button>
            </div>
          </div>

          {/* Embedded add panel */}
          <AnimatePresence initial={false}>
            {agAddOpen && (
              <motion.div
                key="ag-add-panel"
                initial={shouldAnimate ? { height: 0, opacity: 0 } : false}
                animate={{ height: 'auto', opacity: 1 }}
                exit={shouldAnimate ? { height: 0, opacity: 0 } : { opacity: 0 }}
                transition={
                  shouldAnimate
                    ? { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
                    : { duration: 0 }
                }
                className="overflow-hidden"
              >
                <div className="mt-4 rounded-xl border border-neutral-200/70 bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
                  {/* Tab Switcher */}
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800/80">
                    {ADD_TABS.map((tab) => {
                      const active = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id)}
                          className={`relative inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                            active
                              ? 'text-neutral-900 dark:text-neutral-100'
                              : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId={shouldAnimate ? 'settings-ag-add-tab-pill' : undefined}
                              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
                              className="inset-0 absolute rounded-md bg-card shadow-xs dark:bg-neutral-900"
                            />
                          )}
                          <span className="relative z-10 inline-flex items-center gap-1.5">
                            {tab.icon}
                            <span>{tab.label}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={activeTab}
                      initial={shouldAnimate ? { opacity: 0, y: 3 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      exit={shouldAnimate ? { opacity: 0, y: -3 } : { opacity: 1 }}
                      transition={
                        shouldAnimate
                          ? { duration: 0.13, ease: [0.22, 1, 0.36, 1] }
                          : { duration: 0 }
                      }
                    >
                      {/* Tab 1: Browser OAuth */}
                      {activeTab === 'oauth' && (
                        <div className="mt-4 space-y-4">
                          <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                            通过 Google 官方 OAuth 授权登录新账号。不会自动切换或重启当前正在运行的 Antigravity 客户端。
                          </p>

                          {!oauthSession ? (
                            <button
                              type="button"
                              onClick={handleStartOAuth}
                              disabled={oauthStarting}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                            >
                              {oauthStarting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ExternalLink className="h-4 w-4" />
                              )}
                              <span>{oauthStarting ? '正在准备授权...' : '打开浏览器登录 Google 账号'}</span>
                            </button>
                          ) : (
                            <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/70 p-3.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs font-medium text-neutral-800 dark:text-neutral-200">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                                  <span>等待浏览器完成 Google 授权回调...</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={handleCancelOAuth}
                                  className="text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                                >
                                  取消登录
                                </button>
                              </div>

                              {/* Copy Auth URL for Incognito / Other Chrome Profile */}
                              <div>
                                <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                                  授权链接（可复制到无痕窗口或其他浏览器配置文件中打开）
                                </label>
                                <div className="mt-1.5 flex gap-2">
                                  <input
                                    type="text"
                                    readOnly
                                    value={oauthSession.authUrl}
                                    onFocus={(e) => e.currentTarget.select()}
                                    className="w-full rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 text-[11px] text-neutral-700 focus:outline-hidden dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                                  />
                                  <button
                                    type="button"
                                    onClick={handleCopyAuthUrl}
                                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                                  >
                                    {copiedUrl ? (
                                      <>
                                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                                        <span>已复制</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="h-3.5 w-3.5" />
                                        <span>复制</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>

                              {/* Manual Callback URL Fallback */}
                              <form
                                onSubmit={handleManualCallbackSubmit}
                                className="border-t border-neutral-200 pt-3 dark:border-neutral-700/80"
                              >
                                <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                                  若浏览器未能自动回调，可粘贴跳转后的完整 URL（含 code=...）
                                </label>
                                <div className="mt-1.5 flex gap-2">
                                  <input
                                    type="text"
                                    value={manualCallbackUrl}
                                    onChange={(e) => setManualCallbackUrl(e.target.value)}
                                    placeholder="http://127.0.0.1:.../oauth-callback?state=...&code=..."
                                    className="w-full rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                                  />
                                  <button
                                    type="submit"
                                    disabled={oauthCompleting || !manualCallbackUrl.trim()}
                                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                                  >
                                    {oauthCompleting && <Loader2 className="h-3 w-3 animate-spin" />}
                                    <span>提交</span>
                                  </button>
                                </div>
                              </form>
                            </div>
                          )}

                          {oauthError && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                              {oauthError}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tab 2: Refresh Token Import */}
                      {activeTab === 'token' && (
                        <form onSubmit={handleImportTokens} className="mt-4 space-y-3.5">
                          <div>
                            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                              输入 Refresh Token 或 JSON
                            </label>
                            <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                              支持单条 Token（<code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">1//0...</code>）、多行批量导入，以及 Antigravity-Manager 导出的 JSON 格式。
                            </p>
                            <textarea
                              rows={5}
                              value={tokenInput}
                              onChange={(e) => setTokenInput(e.target.value)}
                              placeholder={`1//0e...\n或粘贴 JSON 数组 [{"email":"...","refresh_token":"1//0..."}]`}
                              className="mt-2 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-700 dark:bg-neutral-800/70 dark:text-neutral-200"
                            />
                          </div>

                          {importError && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                              {importError}
                            </div>
                          )}

                          {importResult && (
                            <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-800/40">
                              <div className="font-medium text-neutral-700 dark:text-neutral-300">
                                导入结果：共 {importResult.total} 条，成功 {importResult.success} 条，失败 {importResult.failed} 条
                              </div>
                              {importResult.results.map((item, idx) => (
                                <div key={idx} className="flex items-start gap-1.5 text-[11px]">
                                  {item.success ? (
                                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                  ) : (
                                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                                  )}
                                  <span className="break-all text-neutral-700 dark:text-neutral-300">
                                    <strong>{item.inputLabel}</strong>
                                    {item.success ? ' — 已导入' : ` — ${item.error}`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex justify-end">
                            <button
                              type="submit"
                              disabled={importing || !tokenInput.trim()}
                              className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                            >
                              {importing ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <KeyRound className="h-3.5 w-3.5" />
                              )}
                              <span>{importing ? '正在验证并导入...' : '导入并验证'}</span>
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Tab 3: Capture Current Client Account */}
                      {activeTab === 'capture' && (
                        <div className="mt-4 space-y-4">
                          <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                            自动读取本机 Antigravity 客户端当前已登录的账号凭据（支持新版系统凭据库与旧版数据库）并收录到 Graviton。
                          </p>
                          <button
                            type="button"
                            onClick={handleCaptureCurrent}
                            disabled={capturing}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                          >
                            <MonitorDown className={`h-4 w-4 ${capturing ? 'animate-pulse' : ''}`} />
                            <span>{capturing ? '正在读取并收录...' : '读取本机客户端当前账号'}</span>
                          </button>
                        </div>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Connected Antigravity account list */}
          {agAccounts.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {agAccounts.map((acc) => {
                const tier = acc.subscriptionTier || 'FREE';
                return (
                  <li
                    key={acc.id}
                    className="flex items-center gap-2.5 rounded-xl border border-neutral-200/70 bg-neutral-50/50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950/40"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      {acc.email.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100"
                          title={acc.email}
                        >
                          {acc.email}
                        </span>
                        <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                          {tier}
                        </span>
                        {acc.isCurrent && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            使用中
                          </span>
                        )}
                        {acc.isForbidden && (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                            title={acc.errorMessage || '账号受限'}
                          >
                            <AlertTriangle className="h-2.5 w-2.5" />
                            受限
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                        <Clock className="h-2.5 w-2.5" />
                        上次刷新：{formatRelativeTime(acc.lastRefreshedAt, nowMs)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => useAccountStore.getState().confirmDeleteAccount(acc)}
                      aria-label={`删除账号 ${acc.email}`}
                      title="删除账号记录与独立凭据"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-500 shadow-2xs transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98] dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-400 dark:hover:border-rose-900/50 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Provider Card 2: Qianwen Token Plan */}
      <section className="rounded-2xl border border-neutral-200/80 bg-card/90 p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
        <div
          data-settings-entry-id="provider-qianwen"
          className={`-m-2 p-2 transition-colors ${entryHighlightClass('provider-qianwen')}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
            <div className="flex items-center gap-2.5">
              <ProviderLogo provider="qianwen" size="md" />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    千问 · Token Plan
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      qwAccounts.length > 0
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'
                    }`}
                  >
                    {qwHasLoaded
                      ? qwAccounts.length > 0
                        ? `已连接 ${qwAccounts.length} 个账号`
                        : '未连接'
                      : '加载中...'}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  千问 AI 平台个人版 / 团队版 · OAuth Device Flow 授权
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {qwAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => onNavigateToQuota('/quota/qianwen')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 text-xs font-medium text-neutral-700 shadow-2xs transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                >
                  <span>查看额度</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={toggleQwConnect}
                aria-expanded={qwConnectOpen}
                className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.98] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {qwConnectOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                <span>{qwConnectOpen ? '收起' : '连接千问账号'}</span>
              </button>
            </div>
          </div>

          {/* Embedded Device Flow panel */}
          <AnimatePresence initial={false}>
            {qwConnectOpen && (
              <motion.div
                key="qw-connect-panel"
                initial={shouldAnimate ? { height: 0, opacity: 0 } : false}
                animate={{ height: 'auto', opacity: 1 }}
                exit={shouldAnimate ? { height: 0, opacity: 0 } : { opacity: 0 }}
                transition={
                  shouldAnimate
                    ? { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
                    : { duration: 0 }
                }
                className="overflow-hidden"
              >
                <div className="mt-4 space-y-4 rounded-xl border border-neutral-200/70 bg-neutral-50/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/40">
                  {qwReauthTarget && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                      <span className="truncate">
                        重新授权目标账号：<strong className="font-semibold">{qwReauthLabel}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setQwReauthTarget(null)}
                        className="shrink-0 text-[11px] font-medium text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
                      >
                        改为连接新账号
                      </button>
                    </div>
                  )}

                  <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                    通过千问官方 OAuth 2.0 Device Flow + PKCE 协议授权登录（无需安装 CLI 或配置 AK/SK），授权凭据仅安全保存在 Windows 凭据管理器中。
                  </p>

                  {!qwSession ? (
                    <button
                      type="button"
                      onClick={handleStartQwAuth}
                      disabled={qwStarting}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                    >
                      {qwStarting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : qwErrorMsg ? (
                        <RefreshCw className="h-4 w-4" />
                      ) : (
                        <ExternalLink className="h-4 w-4" />
                      )}
                      <span>
                        {qwStarting
                          ? '正在获取设备授权码...'
                          : qwErrorMsg
                            ? '重新发起授权'
                            : '打开浏览器授权千问账号'}
                      </span>
                    </button>
                  ) : (
                    <div className="space-y-3.5 rounded-lg border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-800/40">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-neutral-800 dark:text-neutral-200">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />
                          <span>
                            {qwPollStatus === 'completing'
                              ? '网页授权成功，正在获取账号信息与套餐额度...'
                              : qwPollStatus === 'slow_down'
                                ? `正在等待网页确认（已自动降频至 ${qwPollInterval}s）...`
                                : `正在等待网页完成授权（每 ${qwPollInterval}s 检查一次）...`}
                          </span>
                        </div>
                        <span className="shrink-0 rounded bg-neutral-200/80 px-1.5 py-0.5 font-mono text-[11px] font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                          {formatCountdown(qwRemainingSec)}
                        </span>
                      </div>

                      {/* Verification URL */}
                      <div>
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                            授权页面链接
                          </label>
                          <button
                            type="button"
                            onClick={() => BrowserOpenURL(qwSession.verificationUrl)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                          >
                            <ExternalLink className="h-3 w-3" />
                            再次打开浏览器
                          </button>
                        </div>
                        <div className="mt-1.5 flex gap-2">
                          <input
                            type="text"
                            readOnly
                            value={qwSession.verificationUrl}
                            onFocus={(e) => e.currentTarget.select()}
                            className="w-full rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 font-mono text-[11px] text-neutral-700 focus:outline-hidden dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                          />
                          <button
                            type="button"
                            onClick={() => handleQwCopy(qwSession.verificationUrl, 'url')}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                          >
                            {qwCopiedUrl ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                                <span>已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                <span>复制</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Device Code */}
                      <div>
                        <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                          设备授权码（Token）
                        </label>
                        <div className="mt-1.5 flex items-center gap-2">
                          <code className="flex-1 truncate rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 font-mono text-xs font-semibold tracking-wide text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                            {qwSession.deviceCode}
                          </code>
                          <button
                            type="button"
                            onClick={() => handleQwCopy(qwSession.deviceCode, 'code')}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                          >
                            {qwCopiedCode ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                                <span>已复制</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                <span>复制</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={handleCancelQwAuth}
                          className="rounded-lg border border-neutral-200 bg-card px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                        >
                          取消等待
                        </button>
                      </div>
                    </div>
                  )}

                  {qwErrorMsg && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{qwErrorMsg}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Connected Qianwen account list */}
          {qwAccounts.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {qwAccounts.map((acc) => {
                const displayName = acc.name || acc.email || acc.aliyunId || '千问账号';
                const personal = acc.quota?.personal;
                const team = acc.quota?.team;
                const hasPersonal = personal?.status === 'active';
                const hasTeam = team?.status === 'active';
                const tierLabel = hasPersonal
                  ? personal?.planName || personal?.specCode || '个人版'
                  : hasTeam
                    ? team?.planName || '团队版'
                    : '未订阅';
                const authExpired = Boolean(acc.quota?.authExpired);

                return (
                  <li
                    key={acc.id}
                    className="flex items-center gap-2.5 rounded-xl border border-neutral-200/70 bg-neutral-50/50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950/40"
                  >
                    <ProviderLogo provider="qianwen" size="row" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="truncate text-xs font-semibold text-neutral-900 dark:text-neutral-100"
                          title={displayName}
                        >
                          {displayName}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            hasPersonal || hasTeam
                              ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                              : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                          }`}
                        >
                          {tierLabel}
                        </span>
                        {authExpired && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                            <KeyRound className="h-2.5 w-2.5" />
                            授权已过期
                          </span>
                        )}
                      </div>
                    </div>
                    {authExpired && (
                      <button
                        type="button"
                        onClick={() => openQwReauth(acc)}
                        className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-neutral-950 dark:hover:bg-amber-400"
                      >
                        重新授权
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => useQianwenStore.getState().confirmDeleteAccount(acc)}
                      aria-label={`移除千问账号 ${displayName}`}
                      title="移除账号与本地凭据"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-card text-neutral-500 shadow-2xs transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98] dark:border-neutral-800 dark:bg-neutral-800/80 dark:text-neutral-400 dark:hover:border-rose-900/50 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </>
  );
};