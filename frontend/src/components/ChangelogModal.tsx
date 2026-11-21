import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Calendar, FileClock, GitCommitHorizontal, X } from 'lucide-react';
import { useAppInfoStore } from '../store/useAppInfoStore';
import { ChangelogChange } from '../types';

export const CHANNEL_META: Record<
  string,
  { label: string; badgeClass: string }
> = {
  stable: {
    label: '正式版',
    badgeClass:
      'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70',
  },
  rc: {
    label: 'RC 候选版',
    badgeClass:
      'bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
  },
  dev: {
    label: '开发版',
    badgeClass:
      'bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/70',
  },
};

export const CHANGE_TYPE_META: Record<
  string,
  { label: string; badgeClass: string }
> = {
  feat: {
    label: '新增',
    badgeClass:
      'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300',
  },
  fix: {
    label: '修复',
    badgeClass:
      'bg-amber-50 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300',
  },
  perf: {
    label: '优化',
    badgeClass:
      'bg-sky-50 text-sky-700 dark:bg-sky-950/70 dark:text-sky-300',
  },
  change: {
    label: '变更',
    badgeClass:
      'bg-violet-50 text-violet-700 dark:bg-violet-950/70 dark:text-violet-300',
  },
  breaking: {
    label: '重大变更',
    badgeClass:
      'bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300',
  },
};

export const ChangeItemRow: React.FC<{ change: ChangelogChange }> = ({
  change,
}) => {
  const meta = CHANGE_TYPE_META[change.type] || {
    label: change.type,
    badgeClass:
      'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  };

  return (
    <li className="flex items-start gap-2 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
      <span
        className={`mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}
      >
        {meta.label}
      </span>
      <span className="min-w-0 flex-1">{change.text}</span>
    </li>
  );
};

export const ChangelogModal: React.FC = () => {
  const { appInfo, changelog, changelogOpen, setChangelogOpen } =
    useAppInfoStore();

  const channelMeta =
    CHANNEL_META[appInfo?.channel || 'dev'] || CHANNEL_META.dev;

  return (
    <Dialog.Root open={changelogOpen} onOpenChange={setChangelogOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs animate-in fade-in-0 duration-150" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[82vh] w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-card shadow-xl animate-in zoom-in-95 fade-in-0 duration-150 dark:border-neutral-800 dark:bg-neutral-900">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-neutral-200/80 px-5 py-4 dark:border-neutral-800">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                <FileClock className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Dialog.Title className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    更新日志
                  </Dialog.Title>
                  {appInfo && (
                    <>
                      <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                        v{appInfo.version}
                      </span>
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${channelMeta.badgeClass}`}
                      >
                        {channelMeta.label}
                      </span>
                    </>
                  )}
                </div>
                <Dialog.Description className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                  <span>按语义化版本记录每次正式版与 RC 候选版变更</span>
                  {appInfo?.commit && appInfo.commit !== 'dev' && (
                    <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                      <GitCommitHorizontal className="h-3 w-3" />
                      {appInfo.commit}
                    </span>
                  )}
                </Dialog.Description>
              </div>
            </div>

            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="关闭更新日志"
                className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {changelog.length === 0 ? (
              <div className="rounded-xl border border-dashed border-neutral-200 py-10 text-center text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                暂无更新日志记录
              </div>
            ) : (
              changelog.map((release) => {
                const isCurrent = appInfo?.version === release.version;
                const relChannel =
                  CHANNEL_META[release.channel] || CHANNEL_META.stable;

                return (
                  <article
                    key={release.version}
                    className={`rounded-xl border p-4 ${
                      isCurrent
                        ? 'border-neutral-300 bg-neutral-50/70 dark:border-neutral-700 dark:bg-neutral-800/40'
                        : 'border-neutral-200/80 bg-card dark:border-neutral-800 dark:bg-neutral-900/40'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                          v{release.version}
                        </span>
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${relChannel.badgeClass}`}
                        >
                          {relChannel.label}
                        </span>
                        {isCurrent && (
                          <span className="rounded-md bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white dark:bg-neutral-100 dark:text-neutral-900">
                            当前版本
                          </span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        <Calendar className="h-3 w-3" />
                        {release.date}
                      </span>
                    </div>

                    {release.title && (
                      <h4 className="mt-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                        {release.title}
                      </h4>
                    )}
                    {release.summary && (
                      <p className="mt-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                        {release.summary}
                      </p>
                    )}

                    <ul className="mt-3 space-y-2 border-t border-neutral-200/60 pt-3 dark:border-neutral-800">
                      {release.changes.map((c, idx) => (
                        <ChangeItemRow key={`${release.version}-${idx}`} change={c} />
                      ))}
                    </ul>
                  </article>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
