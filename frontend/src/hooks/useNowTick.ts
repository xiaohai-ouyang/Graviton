import { useSyncExternalStore } from 'react';

const TICK_INTERVAL_MS = 60_000;

let currentNow = Date.now();
const listeners = new Set<() => void>();
let timerId: number | null = null;

function emit() {
  currentNow = Date.now();
  listeners.forEach((listener) => listener());
}

function startTimer() {
  if (typeof window === 'undefined' || timerId !== null) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return;
  }
  timerId = window.setInterval(emit, TICK_INTERVAL_MS);
}

function stopTimer() {
  if (timerId !== null && typeof window !== 'undefined') {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function handleVisibilityChange() {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') {
    stopTimer();
  } else {
    emit();
    startTimer();
  }
}

function subscribe(listener: () => void): () => void {
  const wasEmpty = listeners.size === 0;
  listeners.add(listener);

  if (wasEmpty) {
    currentNow = Date.now();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    startTimer();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopTimer();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    }
  };
}

function getSnapshot(): number {
  return currentNow;
}

/**
 * Shared singleton 60-second clock tick that pauses automatically while the
 * document is hidden and refreshes immediately when returning to the foreground.
 */
export function useNowTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
