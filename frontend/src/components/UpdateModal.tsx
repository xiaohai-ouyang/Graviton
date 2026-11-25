import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  Hourglass,
  Loader2,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useMotionStore } from '../store/useMotionStore';
import { useUpdateStore } from '../store/useUpdateStore';
import { api, parseError } from '../services/api';
import { useAccountStore } from '../store/useAccountStore';
import { isFeedbackBannerEvent } from '../utils/dialog';
import { CHANNEL_META } from './ChangelogModal';

const INSTALL_MODE_LABEL: Record<string, string> = {
  nsis: '标准安装版',
  portable: '免安装便携版',
  dev: '开发模式',
};

// Structured, safe rendering of GitHub release markdown: headings and list items
// become React nodes; everything else is plain text. No dangerouslySetInnerHTML.
const ReleaseNotes: React.FC<{ notes: string }> = ({ notes }) => {
  const lines = notes.split('\n');
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    nodes.push(
      <ul key={key} className="space-y-1.5">
        {listItems.map((item, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300"
          >
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-400 dark:bg-neutral-500" />
            <span className="min-w-0 flex-1">{item}</span>
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('>')) {
      flushList(`ul-${idx}`);
      return;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      listItems.push(line.slice(2));
      return;
    }
    flushList(`ul-${idx}`);
    if (line.startsWith('### ')) {
      nodes.push(
        <h4 key={idx} className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
          {line.slice(4)}
        </h4>
      );
    } else if (line.startsWith('## ')) {
      nodes.push(
        <h3 key={idx} className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {line.slice(3)}
        </h3>
      );
    } else {
      nodes.push(
        <p key={idx} className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
          {line}
        </p>
      );
    }
  });
  flushList('ul-end');

  return <div className="space-y-2.5">{nodes}</div>;
};

export const UpdateModal: React.FC = () => {
  const {
    state,
    modalOpen,
    setModalOpen,
    installUpdate,
    restartToApply,
    restartNow,
    restartingNow,
    cancelDeferred,
    skipVersion,
  } = useUpdateStore();
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);

  if (!state || !state.latestVersion) {
    return null;
  }

  const isReady = state.status === 'ready';
  const isInstalling = state.status === 'installing';
  const isInstalled = state.status === 'installed';
  const isWaiting = state.status === 'waiting_idle';
  const targetChannel = state.latestVersion.includes('-rc.') ? 'rc' : 'stable';
  const channelMeta = CHANNEL_META[targetChannel] || CHANNEL_META.stable;

  const modalTitle = isWaiting
    ? '已预约空闲重启'
    : isInstalled
      ? '更新已安装完成'
      : isInstalling
        ? '正在安装更新'
        : '发现新版本';

  const headerIconClass = isWaiting
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300'
    : isInstalled
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300'
      : 'bg-sky-100 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300';

  const openGitHub = async () => {
    if (!state.releaseUrl) return;
    try {
      await api.openReleasePage(state.releaseUrl);
    } catch (e) {
      useAccountStore.getState().setBanner({ type: 'error', message: parseError(e).message });
    }
  };

  return (
    <Dialog.Root open={modalOpen} onOpenChange={setModalOpen}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={shouldAnimate ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={shouldAnimate ? { duration: 0.14 } : { duration: 0 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-xs"
          />
        </Dialog.Overlay>
        <Dialog.Content
          asChild
          onPointerDownOutside={(e) => {
            if (isFeedbackBannerEvent(e)) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            if (isFeedbackBannerEvent(e)) {
              e.preventDefault();
            }
          }}
        >
          <motion.div
            initial={shouldAnimate ? { opacity: 0, scale: 0.96, y: 4 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={
              shouldAnimate
                ? { duration: 0.15, ease: [0.22, 1, 0.36, 1] }
                : { duration: 0 }
            }
            className="fixed left-1/2 top-1/2 z-[60] flex max-h-[82vh] w-[92vw] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-card shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200/80 px-5 py-4 dark:border-neutral-800">
              <div className="flex items-center gap-2.5">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${headerIconClass}`}
                >
                  {isWaiting ? (
                    <Hourglass className="h-4 w-4" />
                  ) : isInstalled ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : isInstalling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {modalTitle}
                    </Dialog.Title>
                    <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                      v{state.currentVersion}
                      <ArrowRight className="h-3 w-3" />
                      v{state.latestVersion}
                    </span>
                  </div>
                  <Dialog.Description className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                    <span
                      className={`rounded border px-1 py-0.5 text-[10px] font-medium ${channelMeta.badgeClass}`}
                    >
                      {channelMeta.label}
                    </span>
                    <span className="rounded border border-neutral-200 px-1 py-0.5 text-[10px] font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-300">
                      {INSTALL_MODE_LABEL[state.installMode] || state.installMode}
                    </span>
                    {(isReady || isInstalling) && (
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-200/80 bg-emerald-50 px-1 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-300">
                        <ShieldCheck className="h-3 w-3" />
                        已下载 · SHA-256 校验通过
                      </span>
                    )}
                    {(isInstalled || isWaiting) && (
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-200/80 bg-emerald-50 px-1 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/60 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        已安装 · 待重启生效
                      </span>
                    )}
                  </Dialog.Description>
                </div>
              </div>

              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="关闭更新详情"
                  className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            {/* Body */}
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {isInstalling && (
                <div className="rounded-xl border border-sky-200/80 bg-sky-50 p-3.5 dark:border-sky-800/70 dark:bg-sky-950/50">
                  <div className="flex items-center gap-2 text-xs font-semibold text-sky-800 dark:text-sky-200">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    正在安装 v{state.latestVersion}，请稍候…
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300">
                    {state.installMode === 'nsis'
                      ? '请在系统弹出的权限提示中确认管理员授权；安装将在当前安装目录原地完成，完成后会提示您重启应用。'
                      : '正在应用新版本程序文件，完成后会提示您重启应用以生效。'}
                  </p>
                </div>
              )}

              {isInstalled && (
                <div className="rounded-xl border border-emerald-200/80 bg-emerald-50 p-3.5 dark:border-emerald-800/70 dark:bg-emerald-950/50">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    v{state.latestVersion} 已安装完成
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300">
                    新版本已写入完成，点击「立即重启」即可切换到新版本；如果选择稍后重启，下次打开 Graviton 时也会自动运行新版本。
                  </p>
                </div>
              )}

              {isWaiting && (
                <div className="rounded-xl border border-amber-200/80 bg-amber-50 p-3.5 dark:border-amber-800/70 dark:bg-amber-950/50">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
                    <Hourglass className="h-3.5 w-3.5" />
                    已预约空闲后自动重启
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                    更新已安装完成，以下任务全部结束后将立即自动重启应用以启用新版本：
                  </p>
                  <ul className="mt-2 space-y-1">
                    {(state.busyReasons || []).map((reason, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300"
                      >
                        <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                        {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {state.releaseTitle && (
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {state.releaseTitle}
                </h3>
              )}
              {state.releaseNotes ? (
                <ReleaseNotes notes={state.releaseNotes} />
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-200 py-8 text-center text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                  本次发布未提供变更说明
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200/80 px-5 py-3.5 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => void openGitHub()}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                前往 GitHub 查看
              </button>

              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {isWaiting || isInstalled ? (
                  <>
                    {isWaiting && (
                      <button
                        type="button"
                        disabled={restartingNow}
                        onClick={() => void cancelDeferred()}
                        className="rounded-lg border border-neutral-300 bg-card px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                      >
                        取消预约
                      </button>
                    )}
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-lg border border-neutral-300 bg-card px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                      >
                        {isWaiting ? '关闭' : '稍后重启'}
                      </button>
                    </Dialog.Close>
                    <button
                      type="button"
                      disabled={restartingNow}
                      onClick={() => void (isWaiting ? restartNow() : restartToApply())}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                    >
                      {restartingNow ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      {restartingNow ? '正在重启…' : isWaiting ? '停止项目并重启' : '立即重启'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={isInstalling}
                      onClick={() => state.latestVersion && void skipVersion(state.latestVersion)}
                      className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                    >
                      跳过此版本
                    </button>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        className="rounded-lg border border-neutral-300 bg-card px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                      >
                        稍后
                      </button>
                    </Dialog.Close>
                    <button
                      type="button"
                      disabled={!isReady || isInstalling}
                      onClick={() => void installUpdate()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                    >
                      {isInstalling ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      {isInstalling ? '正在安装…' : '立即安装'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
