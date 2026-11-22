import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { BrowserOpenURL, EventsOn } from '../../wailsjs/runtime/runtime';
import { api, parseError } from '../services/api';
import { useAccountStore } from '../store/useAccountStore';
import { useMotionStore } from '../store/useMotionStore';
import { useQianwenStore } from '../store/useQianwenStore';
import {
  QianwenAccountDisplay,
  QianwenAuthEvent,
  QianwenAuthStartResponse,
} from '../types';

interface QianwenConnectModalProps {
  open: boolean;
  reauthAccount?: QianwenAccountDisplay | null;
  onClose: () => void;
}

export const QianwenConnectModal: React.FC<QianwenConnectModalProps> = ({
  open,
  reauthAccount,
  onClose,
}) => {
  const { loadAccounts } = useQianwenStore();
  const setBanner = useAccountStore((s) => s.setBanner);
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  const [session, setSession] = useState<QianwenAuthStartResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [pollStatus, setPollStatus] = useState<string>('idle');
  const [pollInterval, setPollInterval] = useState<number>(5);
  const [remainingSec, setRemainingSec] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const sessionRef = useRef<QianwenAuthStartResponse | null>(null);
  sessionRef.current = session;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Listen to backend device-flow polling events with a stable subscription
  useEffect(() => {
    if (!open) return;

    const unsubscribe = EventsOn('qianwen:auth', async (evt: QianwenAuthEvent) => {
      if (!evt) return;
      const activeSession = sessionRef.current;
      if (activeSession && evt.sessionId && evt.sessionId !== activeSession.sessionId) {
        return;
      }

      if (evt.status === 'pending' || evt.status === 'slow_down' || evt.status === 'completing') {
        setPollStatus(evt.status);
        if (evt.interval && evt.interval > 0) {
          setPollInterval(evt.interval);
        }
        return;
      }

      if (evt.status === 'complete' && evt.account) {
        setSession(null);
        setPollStatus('idle');
        await loadAccounts();
        const label =
          evt.account.name || evt.account.email || evt.account.aliyunId || '千问账号';
        setBanner({ type: 'success', message: `千问账号连接成功: ${label}` });
        onCloseRef.current();
        return;
      }

      if (evt.status === 'cancelled') {
        setSession(null);
        setPollStatus('idle');
        return;
      }

      if (evt.status === 'expired' || evt.status === 'denied' || evt.status === 'error') {
        setSession(null);
        setPollStatus(evt.status);
        setErrorMsg(evt.error || '授权未完成，请重试');
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [open, loadAccounts, setBanner]);

  // Countdown timer while device code session is active
  const activeSessionId = session?.sessionId ?? '';
  useEffect(() => {
    if (!open || !activeSessionId) return;
    const timer = window.setInterval(() => {
      setRemainingSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open, activeSessionId]);

  const resetLocalState = () => {
    setSession(null);
    setStarting(false);
    setPollStatus('idle');
    setPollInterval(5);
    setRemainingSec(0);
    setErrorMsg(null);
    setCopiedUrl(false);
    setCopiedCode(false);
  };

  const handleClose = () => {
    if (session) {
      void api.cancelQianwenAuth().catch(() => {});
    }
    resetLocalState();
    onClose();
  };

  const handleStartAuth = async () => {
    setErrorMsg(null);
    setStarting(true);
    setCopiedUrl(false);
    setCopiedCode(false);
    try {
      const res = await api.startQianwenAuth(reauthAccount?.id ?? '');
      setSession(res);
      setPollStatus('pending');
      setPollInterval(res.interval || 5);
      setRemainingSec(res.expiresIn || 300);
    } catch (e) {
      setErrorMsg(parseError(e).message);
    } finally {
      setStarting(false);
    }
  };

  const handleCancelAuth = async () => {
    await api.cancelQianwenAuth().catch(() => {});
    resetLocalState();
  };

  const handleCopy = async (text: string, which: 'url' | 'code') => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'url') {
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
      } else {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      }
    } catch {
      setErrorMsg('复制失败，请手动选中文本复制');
    }
  };

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const reauthLabel =
    reauthAccount?.name || reauthAccount?.email || reauthAccount?.aliyunId;

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={shouldAnimate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={shouldAnimate ? { duration: 0.14 } : { duration: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs"
          />
        </Dialog.Overlay>
        <Dialog.Content asChild>
          <motion.div
            initial={shouldAnimate ? { opacity: 0, scale: 0.96, y: 4 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={
              shouldAnimate
                ? { duration: 0.15, ease: [0.22, 1, 0.36, 1] }
                : { duration: 0 }
            }
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-card p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 pb-4 dark:border-neutral-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                  <Link2 className="h-4 w-4" />
                </div>
                <div>
                  <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                    {reauthAccount ? '重新授权千问账号' : '连接千问账号'}
                  </Dialog.Title>
                  {reauthLabel && (
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      目标账号：{reauthLabel}
                    </p>
                  )}
                </div>
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label="关闭"
                  className="rounded-md p-1.5 text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            <div className="mt-4 space-y-4">
              <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                通过千问官方 OAuth 2.0 Device Flow + PKCE 协议授权登录（无需安装 CLI 或配置 AK/SK），授权凭据仅安全保存在 Windows 凭据管理器中。
              </p>

              {!session ? (
                <button
                  type="button"
                  onClick={handleStartAuth}
                  disabled={starting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-neutral-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  {starting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : errorMsg ? (
                    <RefreshCw className="h-4 w-4" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                  <span>
                    {starting
                      ? '正在获取设备授权码...'
                      : errorMsg
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
                        {pollStatus === 'completing'
                          ? '网页授权成功，正在获取账号信息与套餐额度...'
                          : pollStatus === 'slow_down'
                            ? `正在等待网页确认（已自动降频至 ${pollInterval}s）...`
                            : `正在等待网页完成授权（每 ${pollInterval}s 检查一次）...`}
                      </span>
                    </div>
                    <span className="shrink-0 rounded bg-neutral-200/80 px-1.5 py-0.5 font-mono text-[11px] font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                      {formatCountdown(remainingSec)}
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
                        onClick={() => BrowserOpenURL(session.verificationUrl)}
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
                        value={session.verificationUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        className="w-full rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 font-mono text-[11px] text-neutral-700 focus:outline-hidden dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                      />
                      <button
                        type="button"
                        onClick={() => handleCopy(session.verificationUrl, 'url')}
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

                  {/* Device Code */}
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                      设备授权码（Token）
                    </label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="flex-1 truncate rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 font-mono text-xs font-semibold tracking-wide text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
                        {session.deviceCode}
                      </code>
                      <button
                        type="button"
                        onClick={() => handleCopy(session.deviceCode, 'code')}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 bg-card px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                      >
                        {copiedCode ? (
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
                      onClick={handleCancelAuth}
                      className="rounded-lg border border-neutral-200 bg-card px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                    >
                      取消等待
                    </button>
                  </div>
                </div>
              )}

              {errorMsg && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
