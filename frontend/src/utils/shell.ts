export type ShellType = 'powershell' | 'gitbash' | 'cmd';
export type ShellOverride = '' | ShellType;

export interface ShellMeta {
  shortLabel: string;
  label: string;
  optionLabel: string;
  prompt: string;
  badgeClass: string;
}

export const SHELL_ORDER: ShellType[] = ['powershell', 'gitbash', 'cmd'];

export const SHELL_META: Record<ShellType, ShellMeta> = {
  powershell: {
    shortLabel: 'PS',
    label: 'PowerShell',
    optionLabel: 'PowerShell',
    prompt: 'PS>',
    badgeClass: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  },
  gitbash: {
    shortLabel: 'Bash',
    label: 'Git Bash',
    optionLabel: 'Git Bash',
    prompt: '$',
    badgeClass: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  cmd: {
    shortLabel: 'CMD',
    label: 'CMD',
    optionLabel: 'CMD (cmd.exe)',
    prompt: '>',
    badgeClass: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
};

export function normalizeShellOverride(shell?: string | null): ShellOverride {
  switch ((shell ?? '').trim().toLowerCase()) {
    case '':
    case 'default':
    case 'auto':
      return '';
    case 'powershell':
    case 'pwsh':
    case 'pwsh.exe':
    case 'ps':
    case 'powershell.exe':
      return 'powershell';
    case 'gitbash':
    case 'git-bash':
    case 'git_bash':
    case 'git bash':
    case 'bash':
    case 'bash.exe':
    case 'sh':
      return 'gitbash';
    case 'cmd':
    case 'cmd.exe':
    case 'bat':
      return 'cmd';
    default:
      return '';
  }
}

export function normalizeDefaultShell(shell?: string | null): ShellType {
  const normalized = normalizeShellOverride(shell);
  return normalized || 'powershell';
}

export function resolveEffectiveShell(cmdShell?: string | null, defaultShell?: string | null): ShellType {
  const override = normalizeShellOverride(cmdShell);
  if (override) return override;
  return normalizeDefaultShell(defaultShell);
}
