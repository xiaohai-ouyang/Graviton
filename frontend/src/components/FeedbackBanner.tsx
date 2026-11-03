import React from 'react';
import { useAccountStore } from '../store/useAccountStore';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

export const FeedbackBanner: React.FC = () => {
  const { banner, clearBanner } = useAccountStore();
  const shouldReduceMotion = useReducedMotion();

  if (!banner) return null;

  const isSuccess = banner.type === 'success';
  const isError = banner.type === 'error';

  return (
    <motion.div
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      className={`relative mx-6 mt-4 flex items-center justify-between rounded-lg border px-4 py-3 text-sm shadow-xs transition-colors ${
        isSuccess
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200'
          : isError
          ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200'
          : 'border-neutral-200 bg-neutral-100 text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200'
      }`}
      role="alert"
    >
      <div className="flex items-center gap-2.5">
        {isSuccess ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : isError ? (
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
        ) : (
          <Info className="h-4 w-4 shrink-0 text-neutral-600 dark:text-neutral-400" />
        )}
        <span className="font-medium leading-relaxed">{banner.message}</span>
      </div>
      <button
        onClick={clearBanner}
        aria-label="关闭通知"
        className="ml-4 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md p-1 opacity-70 transition-opacity hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
};
