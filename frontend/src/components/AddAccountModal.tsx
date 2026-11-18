import React, { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  MonitorDown,
  UserPlus,
  X,
  XCircle,
} from 'lucide-react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { api, parseError } from '../services/api';
import { useAccountStore } from '../store/useAccountStore';
import { BatchImportResult, OAuthCompletionEvent, OAuthStartResult } from '../types';

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
}

type AddTab = 'oauth' | 'token' | 'capture';

export const AddAccountModal: React.FC<AddAccountModalProps> = ({ open, onClose }) => {
  const { loadAccounts, captureCurrentAccount, capturing, setBanner } = useAccountStore();

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

  // Listen for asynchronous OAuth callback completion from Go backend
  useEffect(() => {
    if (!open) return;

    const unsubscribe = EventsOn('oauth:completed', async (evt: OAuthCompletionEvent) => {
      setOAuthSession(null);
      setOAuthCompleting(false);
      if (evt?.error) {
        setOAuthError(evt.error);
        return;
      }
      if (evt?.account) {
        await loadAccounts();
        setBanner({ type: 'success', message: `OAuth 登录成功: ${evt.account.email}` });
        onClose();
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [open, loadAccounts, setBanner, onClose]);

  const handleClose = () => {
    if (oauthSession) {
      void api.cancelOAuthLogin().catch(() => {});
      setOAuthSession(null);
    }
    setOAuthError(null);
    setManualCallbackUrl('');
    setCopiedUrl(false);
    onClose();
  };

  const handleStartOAuth = async () => {
    setOAuthError(null);
    setOAuthStarting(true);
    setCopiedUrl(false);
    try {
      const res = await api.startOAuthLogin();
      setOAuthSession(res);
    } catch (e) {
      setOAuthError(parseError(e).message);
    } finally {
      setOAuthStarting(false);
    }
  };

  const handleCancelOAuth = async () => {
    await api.cancelOAuthLogin().catch(() => {});
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
      setOAuthSession(null);
      setManualCallbackUrl('');
      await loadAccounts();
      setBanner({ type: 'success', message: `OAuth 登录成功: ${acc.email}` });
      onClose();
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
        await loadAccounts();
        setBanner({
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
    await captureCurrentAccount();
    const currentBanner = useAccountStore.getState().banner;
    if (currentBanner?.type === 'success') {
      onClose();
    }
  };

  const tabs: { id: AddTab; label: string; icon: React.ReactNode }[] = [
    { id: 'oauth', label: 'OAuth 登录', icon: <ExternalLink className="h-3.5 w-3.5" /> },
    { id: 'token', label: '导入 Token', icon: <KeyRound className="h-3.5 w-3.5" /> },
    { id: 'capture', label: '收录当前账号', icon: <MonitorDown className="h-3.5 w-3.5" /> },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs animate-in fade-in-0 duration-150" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-card p-6 shadow-xl animate-in zoom-in-95 fade-in-0 duration-150 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-4 dark:border-neutral-800">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                <UserPlus className="h-4 w-4" />
              </div>
              <Dialog.Title className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                添加账号
              </Dialog.Title>
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

          {/* Tab Switcher */}
          <div className="mt-4 grid grid-cols-3 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800/80">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-card text-neutral-900 shadow-xs dark:bg-neutral-900 dark:text-neutral-100'
                      : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

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
                  <form onSubmit={handleManualCallbackSubmit} className="border-t border-neutral-200 pt-3 dark:border-neutral-700/80">
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
                自动读取本机 Antigravity 客户端当前已登录的账号凭据（支持新版系统凭据库与旧版数据库）并收录到 CodeTool。
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
