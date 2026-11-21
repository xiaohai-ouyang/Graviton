import React from 'react';
import { AccountDisplay } from '../types';
import { motion, useReducedMotion } from 'motion/react';
import { Clock, Layers, Sparkles } from 'lucide-react';
import { ResetTimeText } from './ResetTimeText';
import { useResetTimeStore } from '../store/useResetTimeStore';
import { useNowTick } from '../hooks/useNowTick';

interface AccountQuotaDetailProps {
  account: AccountDisplay;
}

export const AccountQuotaDetail: React.FC<AccountQuotaDetailProps> = ({ account }) => {
  const shouldReduceMotion = useReducedMotion();
  const resetTimeFormat = useResetTimeStore((s) => s.resetTimeFormat);
  const nowMs = useNowTick();
  const groups = account.groups || [];
  const models = account.models || [];

  return (
    <motion.div
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: 'easeInOut' }}
      className="overflow-hidden border-t border-neutral-100 bg-neutral-50/70 p-4 text-xs dark:border-neutral-800/80 dark:bg-neutral-950/50"
    >
      <div className="space-y-4">
        {/* Quota Groups & Windows */}
        {groups.length > 0 ? (
          <div>
            <div className="mb-2.5 flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-300">
              <Layers className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
              <span>模型分组额度窗口 (retrieveUserQuotaSummary)</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((group, gIdx) => (
                <div
                  key={gIdx}
                  className="rounded-lg border border-neutral-200/90 bg-card text-card-foreground p-3 shadow-2xs transition-colors dark:border-neutral-800 dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700"
                >
                  <div className="flex items-center justify-between border-b border-neutral-100 pb-2 dark:border-neutral-800">
                    <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                      {group.displayName || '通用分组'}
                    </span>
                    {group.description && (
                      <span className="truncate text-[10px] text-neutral-500 dark:text-neutral-400 max-w-[130px]" title={group.description}>
                        {group.description}
                      </span>
                    )}
                  </div>

                  <div className="mt-2.5 space-y-2.5">
                    {group.buckets && group.buckets.length > 0 ? (
                      group.buckets.map((b, bIdx) => {
                        const pct = Math.round(b.remainingFraction * 100);
                        const isLow = pct <= 15;
                        const isMid = pct > 15 && pct <= 50;

                        return (
                          <div key={bIdx} className="space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-medium text-neutral-600 dark:text-neutral-300">
                                {b.displayName || b.window || b.bucketId || '配额窗口'}
                              </span>
                              <span className={`font-mono font-semibold ${
                                isLow
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : isMid
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-neutral-900 dark:text-neutral-100'
                              }`}>
                                {pct}%
                              </span>
                            </div>

                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  isLow
                                    ? 'bg-rose-500'
                                    : isMid
                                    ? 'bg-amber-500'
                                    : 'bg-emerald-500 dark:bg-emerald-400'
                                }`}
                                style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                              />
                            </div>

                            {b.resetTime && (
                              <div className="flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                                <Clock className="h-2.5 w-2.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
                                <ResetTimeText
                                  resetTime={b.resetTime}
                                  format={resetTimeFormat}
                                  nowMs={nowMs}
                                  absoluteStyle="prefix"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">该组暂无生效中的计费窗口</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            暂无独立分组窗口数据（将在下一次刷新时自动拉取）
          </p>
        )}

        {/* Detailed Models Breakdown */}
        {models.length > 0 && (
          <div className="pt-2">
            <div className="mb-2 flex items-center gap-1.5 font-medium text-neutral-700 dark:text-neutral-300">
              <Sparkles className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
              <span>可用模型与额度明细</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {models.map((m, mIdx) => (
                <div
                  key={mIdx}
                  className="inline-flex items-center gap-2 rounded-md border border-neutral-200/90 bg-card text-card-foreground px-2.5 py-1 text-[11px] shadow-2xs transition-colors dark:border-neutral-800 dark:bg-neutral-900 hover:border-neutral-300 dark:hover:border-neutral-700"
                >
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                    {m.displayName || m.name}
                  </span>
                  <span className={`font-mono font-semibold ${
                    m.percentage <= 15 && m.percentage >= 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : m.percentage <= 50 && m.percentage > 15
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-neutral-900 dark:text-neutral-100'
                  }`}>
                    {m.percentage >= 0 ? `${m.percentage}%` : '未知'}
                  </span>
                  {m.resetTime && (
                    <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                      (
                      <ResetTimeText
                        resetTime={m.resetTime}
                        format={resetTimeFormat}
                        nowMs={nowMs}
                        absoluteStyle="bare"
                      />
                      )
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};
