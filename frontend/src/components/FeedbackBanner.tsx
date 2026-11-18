import React, { useEffect, useRef, useState } from 'react';
import { useAccountStore } from '../store/useAccountStore';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

export const FeedbackBanner: React.FC = () => {
  const { banner, clearBanner } = useAccountStore();
  const shouldReduceMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!banner || hovered) return;

    const duration = banner.type === 'error' ? 5500 : 3500;
    timerRef.current = window.setTimeout(() => {
      clearBanner();
    }, duration);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [banner, hovered, clearBanner]);

  const isSuccess = banner?.type === 'success';
  const isError = banner?.type === 'error';

  return (
    <div className="pointer-events-none fixed top-4 right-5 z-[100] flex max-w-md flex-col items-end gap-2">
      <AnimatePresence mode="wait">
        {banner && (
          <motion.div
            key={`${banner.type}:${banner.message}`}
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className={`pointer-events-auto flex min-w-[260px] items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-md ${
              isSuccess
                ? 'border-emerald-200/90 bg-white/95 text-emerald-900 dark:border-emerald-800/70 dark:bg-neutral-900/95 dark:text-emerald-200'
                : isError
                ? 'border-rose-200/90 bg-white/95 text-rose-900 dark:border-rose-800/70 dark:bg-neutral-900/95 dark:text-rose-200'
                : 'border-neutral-200/90 bg-white/95 text-neutral-800 dark:border-neutral-700/80 dark:bg-neutral-900/95 dark:text-neutral-200'
            }`}
            role="alert"
          >
            <div className="flex items-start gap-2.5 pt-0.5">
              {isSuccess ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : isError ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-neutral-600 dark:text-neutral-400" />
              )}
              <span className="font-medium leading-snug break-words">{banner.message}</span>
            </div>
            <button
              onClick={clearBanner}
              aria-label="关闭通知"
              className="-mr-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-60 transition-opacity hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
