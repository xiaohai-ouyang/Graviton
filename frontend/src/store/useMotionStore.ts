import { create } from 'zustand';

export type MotionMode = 'auto' | 'full' | 'off';

interface AutoEvaluation {
  resolved: 'full' | 'off';
  reason: string;
  summary: string;
}

export interface MotionState {
  motionMode: MotionMode;
  resolvedMotion: 'full' | 'off';
  shouldAnimate: boolean;
  autoReason: string;
  autoSummary: string;
  setMotionMode: (mode: MotionMode) => void;
  initMotion: () => () => void;
}

const STORAGE_KEY = 'graviton_motion_mode';

function getStoredMotionMode(): MotionMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'auto' || saved === 'full' || saved === 'off') {
      return saved;
    }
  } catch {
    // Ignore storage access errors
  }
  return 'auto';
}

function evaluateAutoMotion(): AutoEvaluation {
  if (typeof window === 'undefined') {
    return {
      resolved: 'full',
      reason: '默认启用过渡效果',
      summary: '已开',
    };
  }

  // 1. OS / Browser prefers-reduced-motion accessibility & performance setting
  if (
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return {
      resolved: 'off',
      reason: '检测到系统已开启「减弱动画」，已自动关闭过渡效果',
      summary: '已关 (系统减弱动画)',
    };
  }

  // 2. Hardware concurrency (logical CPU cores) & device memory
  const nav = window.navigator as Navigator & { deviceMemory?: number };
  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 8;
  const memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined;

  if (cores <= 4) {
    return {
      resolved: 'off',
      reason: `检测到低功耗处理器 (${cores} 逻辑核心)，已自动关闭过渡效果以保障流畅度`,
      summary: `已关 (${cores}核)`,
    };
  }

  if (memory !== undefined && memory <= 4) {
    return {
      resolved: 'off',
      reason: `检测到设备内存较小 (≤${memory}GB)，已自动关闭过渡效果以保障流畅度`,
      summary: `已关 (≤${memory}GB)`,
    };
  }

  const hwSummary = `${cores}核${memory ? `/${memory}GB` : ''}`;
  return {
    resolved: 'full',
    reason: `设备性能充足 (${cores} 核${memory ? ` / ${memory}GB` : ''})，已自动启用全部过渡效果`,
    summary: `已开 (${hwSummary})`,
  };
}

function applyMotionToDOM(resolved: 'full' | 'off') {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'off') {
    root.classList.add('motion-off');
  } else {
    root.classList.remove('motion-off');
  }
}

function resolveState(mode: MotionMode): {
  resolvedMotion: 'full' | 'off';
  shouldAnimate: boolean;
  autoReason: string;
  autoSummary: string;
} {
  const autoEval = evaluateAutoMotion();
  const resolvedMotion: 'full' | 'off' =
    mode === 'auto' ? autoEval.resolved : mode;
  return {
    resolvedMotion,
    shouldAnimate: resolvedMotion === 'full',
    autoReason: autoEval.reason,
    autoSummary: autoEval.summary,
  };
}

export const useMotionStore = create<MotionState>((set, get) => {
  const initialMode = getStoredMotionMode();
  const initialResolved = resolveState(initialMode);

  return {
    motionMode: initialMode,
    ...initialResolved,
    setMotionMode: (mode: MotionMode) => {
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch {
        // Ignore storage write errors
      }
      const next = resolveState(mode);
      applyMotionToDOM(next.resolvedMotion);
      set({
        motionMode: mode,
        ...next,
      });
    },
    initMotion: () => {
      const mode = getStoredMotionMode();
      const next = resolveState(mode);
      applyMotionToDOM(next.resolvedMotion);
      set({
        motionMode: mode,
        ...next,
      });

      if (typeof window === 'undefined') {
        return () => {};
      }

      const mediaQuery = window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

      const handleChange = () => {
        const currentMode = get().motionMode;
        const updated = resolveState(currentMode);
        applyMotionToDOM(updated.resolvedMotion);
        set(updated);
      };

      const handleStorage = (e: StorageEvent) => {
        if (e.key === STORAGE_KEY) {
          const newMode = getStoredMotionMode();
          const updated = resolveState(newMode);
          applyMotionToDOM(updated.resolvedMotion);
          set({
            motionMode: newMode,
            ...updated,
          });
        }
      };

      mediaQuery?.addEventListener('change', handleChange);
      window.addEventListener('storage', handleStorage);

      return () => {
        mediaQuery?.removeEventListener('change', handleChange);
        window.removeEventListener('storage', handleStorage);
      };
    },
  };
});
