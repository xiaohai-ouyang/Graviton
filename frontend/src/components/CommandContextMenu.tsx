import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Pin, PinOff, Terminal, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMotionStore } from '../store/useMotionStore';
import { ProjectCommand } from '../types';

export interface CommandContextMenuState {
  projectId: string;
  command: ProjectCommand;
  x: number;
  y: number;
}

interface CommandContextMenuProps {
  state: CommandContextMenuState | null;
  onClose: () => void;
  onEdit: (projectId: string, command: ProjectCommand) => void;
  onTogglePin: (projectId: string, commandId: string) => void;
  onOpenInTerminal: (projectId: string, commandId: string) => void;
  onDelete: (projectId: string, commandId: string) => void;
}

const VIEWPORT_PADDING = 8;

export const CommandContextMenu: React.FC<CommandContextMenuProps> = ({
  state,
  onClose,
  onEdit,
  onTogglePin,
  onOpenInTerminal,
  onDelete,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);
  const [clamped, setClamped] = useState<{
    key: CommandContextMenuState;
    left: number;
    top: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!state || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - rect.width - VIEWPORT_PADDING);
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - rect.height - VIEWPORT_PADDING);
    const left = Math.min(Math.max(VIEWPORT_PADDING, state.x), maxLeft);
    const top = Math.min(Math.max(VIEWPORT_PADDING, state.y), maxTop);
    setClamped({ key: state, left, top });
  }, [state]);

  useEffect(() => {
    if (!state) return;

    const handleOutsidePointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const handleWindowChange = () => {
      onClose();
    };

    document.addEventListener('mousedown', handleOutsidePointer);
    document.addEventListener('contextmenu', handleOutsidePointer);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleWindowChange, true);
    window.addEventListener('resize', handleWindowChange);

    return () => {
      document.removeEventListener('mousedown', handleOutsidePointer);
      document.removeEventListener('contextmenu', handleOutsidePointer);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleWindowChange, true);
      window.removeEventListener('resize', handleWindowChange);
    };
  }, [state, onClose]);

  if (typeof document === 'undefined') return null;

  const left = state ? (clamped && clamped.key === state ? clamped.left : state.x) : 0;
  const top = state ? (clamped && clamped.key === state ? clamped.top : state.y) : 0;

  return createPortal(
    <AnimatePresence>
      {state && (
        <motion.div
          key={`${state.projectId}:${state.command.id}`}
          ref={menuRef}
          role="menu"
          aria-label={`指令 ${state.command.name} 操作`}
          initial={shouldAnimate ? { opacity: 0, scale: 0.95, y: -4 } : false}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={shouldAnimate ? { opacity: 0, scale: 0.95, y: -4 } : { opacity: 0 }}
          transition={
            shouldAnimate
              ? { duration: 0.13, ease: [0.22, 1, 0.36, 1] }
              : { duration: 0 }
          }
          style={{ left, top, transformOrigin: 'top left' }}
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-44 rounded-xl border border-neutral-200 bg-card p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onEdit(state.projectId, state.command);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>编辑指令</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onTogglePin(state.projectId, state.command.id);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            {state.command.pinned ? (
              <PinOff className="h-3.5 w-3.5" />
            ) : (
              <Pin className="h-3.5 w-3.5" />
            )}
            <span>{state.command.pinned ? '取消置顶' : '置顶常用'}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onOpenInTerminal(state.projectId, state.command.id);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <Terminal className="h-3.5 w-3.5" />
            <span>在外部终端打开</span>
          </button>

          <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onDelete(state.projectId, state.command.id);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>删除指令</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
