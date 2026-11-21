import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEnvStore } from '../store/useEnvStore';
import { useMotionStore } from '../store/useMotionStore';
import { ProjectCommand } from '../types';
import {
  SHELL_META,
  ShellOverride,
  ShellType,
  normalizeDefaultShell,
  normalizeShellOverride,
  resolveEffectiveShell,
} from '../utils/shell';

interface CommandModalProps {
  open: boolean;
  initial?: ProjectCommand | null;
  onClose: () => void;
  onSave: (cmd: ProjectCommand) => Promise<boolean>;
}

const CATEGORIES = [
  { value: 'dev', label: '开发启动' },
  { value: 'build', label: '构建打包' },
  { value: 'test', label: '测试' },
  { value: 'lint', label: '代码检查' },
  { value: 'other', label: '其他' },
];

const PLACEHOLDERS: Record<ShellType, string> = {
  powershell: '例如：\n$env:NODE_ENV = "development"\nbun run dev:desktop',
  gitbash: '例如：\nexport NODE_ENV="development"\nbun run dev:desktop',
  cmd: '例如：\nset "NODE_ENV=development"\nbun run dev:desktop',
};

const HELPERS: Record<ShellType, string> = {
  powershell:
    '将以 UTF-8 PowerShell 脚本（.ps1）逐行执行（优先 pwsh 7 / 回退 PowerShell 5.1），原样保留双引号与变量。',
  gitbash:
    '将以 Git Bash（bash.exe）非登录模式执行纯 UTF-8/LF 脚本，直接支持 export、grep、&& 等 Bash 语法。',
  cmd:
    '将以 cmd.exe 执行并原样透传双引号（不转义为 \\"）；包含多行时自动以批处理脚本（.cmd）顺序执行。',
};

const normalizeCommandInput = (value: string): string =>
  value.replace(/\r\n?/g, '\n').trim();

export const CommandModal: React.FC<CommandModalProps> = ({ open, initial, onClose, onSave }) => {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [cwd, setCwd] = useState('');
  const [shell, setShell] = useState<ShellOverride>('');
  const [category, setCategory] = useState('dev');
  const [pinned, setPinned] = useState(true);
  const [saving, setSaving] = useState(false);

  const shouldAnimate = useMotionStore((s) => s.shouldAnimate);
  const shellEnv = useEnvStore((s) => s.shellEnv);

  const defaultShell = normalizeDefaultShell(shellEnv?.config.defaultShell);
  const gitBashInfo = shellEnv?.shells?.find((s) => s.shell === 'gitbash');
  const gitBashAvailable = gitBashInfo ? gitBashInfo.available : true;
  const effectiveShell = resolveEffectiveShell(shell, defaultShell);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setCommand(initial.command);
      setCwd(initial.cwd || '');
      setShell(normalizeShellOverride(initial.shell));
      setCategory(initial.category || 'other');
      setPinned(Boolean(initial.pinned));
    } else {
      setName('');
      setCommand('');
      setCwd('');
      setShell('');
      setCategory('dev');
      setPinned(true);
    }
  }, [open, initial]);

  const submitCommand = async () => {
    const trimmedName = name.trim();
    const normalizedCommand = normalizeCommandInput(command);
    if (saving || !trimmedName || !normalizedCommand) return;
    setSaving(true);
    const ok = await onSave({
      id: initial?.id || '',
      name: trimmedName,
      command: normalizedCommand,
      cwd: cwd.trim(),
      shell,
      category,
      pinned,
      source: 'manual',
      subProject: cwd.trim(),
    });
    setSaving(false);
    if (ok) onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitCommand();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={shouldAnimate ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={shouldAnimate ? { duration: 0.14 } : { duration: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
        >
          <motion.div
            initial={shouldAnimate ? { opacity: 0, scale: 0.96, y: 4 } : false}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={shouldAnimate ? { opacity: 0, scale: 0.96, y: 4 } : { opacity: 0 }}
            transition={
              shouldAnimate
                ? { duration: 0.15, ease: [0.22, 1, 0.36, 1] }
                : { duration: 0 }
            }
            className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-card p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-center justify-between border-b border-neutral-100 pb-3 dark:border-neutral-800">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {initial ? '编辑指令' : '新增自定义指令'}
              </h3>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  指令名称
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：启动桌面端"
                  className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-900 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    执行命令
                  </label>
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                    支持换行多行脚本 · Ctrl/Cmd+Enter 保存
                  </span>
                </div>
                <textarea
                  required
                  rows={4}
                  spellCheck={false}
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      void submitCommand();
                    }
                  }}
                  placeholder={PLACEHOLDERS[effectiveShell]}
                  className="mt-1.5 w-full resize-y rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs leading-5 text-neutral-900 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
                <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                  {HELPERS[effectiveShell]}
                </p>
                {effectiveShell === 'gitbash' && !gitBashAvailable && (
                  <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                    未检测到可用的 Git Bash，运行前请安装 Git for Windows 或在「设置」页手动指定路径。
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  工作目录 (可选)
                </label>
                <input
                  type="text"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="默认项目根目录，如 frontend"
                  className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-900 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    执行环境
                  </label>
                  <select
                    value={shell}
                    onChange={(e) => setShell(normalizeShellOverride(e.target.value))}
                    className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-900 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  >
                    <option value="">跟随默认 ({SHELL_META[defaultShell].label})</option>
                    <option value="powershell">PowerShell</option>
                    <option value="gitbash">
                      {gitBashAvailable ? 'Git Bash' : 'Git Bash（未检测到）'}
                    </option>
                    <option value="cmd">CMD (cmd.exe)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                    分类
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-900 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-neutral-700 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => setPinned(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-neutral-300 accent-neutral-900 dark:accent-neutral-100"
                />
                <span>置顶为核心常用指令（默认展示在卡片上方）</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-neutral-200 px-3.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim() || !normalizeCommandInput(command)}
                  className="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
