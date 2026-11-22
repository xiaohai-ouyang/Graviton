import type React from 'react';
import { Shield, SlidersHorizontal, Sparkles, Terminal } from 'lucide-react';
import { SettingsSectionId } from '../../store/useSettingsModalStore';

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  label: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface SettingsSearchEntry {
  id: string;
  section: SettingsSectionId;
  title: string;
  description: string;
  keywords: string[];
}

export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  {
    id: 'general',
    label: '常规与外观',
    title: '常规与外观',
    subtitle: '界面主题、过渡动效、时间格式与桌面悬浮窗',
    icon: SlidersHorizontal,
  },
  {
    id: 'environment',
    label: '客户端与 Shell',
    title: '客户端与 Shell',
    subtitle: 'Antigravity 客户端路径、默认执行 Shell 与 Git Bash 配置',
    icon: Terminal,
  },
  {
    id: 'ai',
    label: 'AI 助手',
    title: 'AI 助手',
    subtitle: '配置 OpenAI 兼容接口，导入项目时自动优化指令与中文命名',
    icon: Sparkles,
  },
  {
    id: 'about',
    label: '安全与关于',
    title: '安全与关于',
    subtitle: '应用更新、本地数据安全说明、构建版本信息与更新日志',
    icon: Shield,
  },
];

export const SETTINGS_SECTION_MAP: Record<SettingsSectionId, SettingsSectionMeta> = {
  general: SETTINGS_SECTIONS[0],
  environment: SETTINGS_SECTIONS[1],
  ai: SETTINGS_SECTIONS[2],
  about: SETTINGS_SECTIONS[3],
};

export const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
  {
    id: 'theme',
    section: 'general',
    title: '界面外观',
    description: '选择跟随系统、浅色或深色主题模式',
    keywords: ['theme', 'appearance', 'dark', 'light', 'system', '主题', '深色', '浅色', '暗黑', '跟随系统'],
  },
  {
    id: 'motion',
    section: 'general',
    title: '过渡动效',
    description: '控制页面切换、列表展开收缩与排序动画效果',
    keywords: ['motion', 'animation', 'reduced motion', '动效', '动画', '过渡', '性能', '自动'],
  },
  {
    id: 'reset-time',
    section: 'general',
    title: '重置时间格式',
    description: '切换剩余倒计时或具体重置时间点显示模式',
    keywords: ['reset time', 'countdown', 'format', '时间格式', '倒计时', '具体时间', '重置时间', '额度'],
  },
  {
    id: 'widget-top',
    section: 'general',
    title: '悬浮窗置顶',
    description: '控制桌面悬浮窗是否始终置顶于其他窗口之上',
    keywords: ['widget', 'always on top', 'pin', '悬浮窗', '置顶', '桌面', '小窗'],
  },
  {
    id: 'client-path',
    section: 'environment',
    title: 'Antigravity 客户端路径',
    description: '自动探测或手动指定 Antigravity 可执行文件路径',
    keywords: ['client', 'path', 'executable', 'antigravity', '客户端', '路径', '安装目录', '可执行文件'],
  },
  {
    id: 'default-shell',
    section: 'environment',
    title: '默认执行 Shell',
    description: '切换 PowerShell、Git Bash 或 CMD 全局默认终端环境',
    keywords: ['shell', 'powershell', 'pwsh', 'cmd', 'git bash', 'terminal', '终端', '命令行', '执行环境'],
  },
  {
    id: 'git-bash-path',
    section: 'environment',
    title: 'Git Bash 路径',
    description: '自动探测或手动指定 Git for Windows 的 bash.exe 路径',
    keywords: ['git bash', 'bash.exe', 'wsl', 'git for windows', 'bash', '恢复自动', '路径'],
  },
  {
    id: 'ai-assistant',
    section: 'ai',
    title: '轻量 AI 指令助手',
    description: '配置 OpenAI 兼容接口 Base URL、API Key 与模型名称',
    keywords: [
      'ai',
      'openai',
      'base url',
      'baseurl',
      'api key',
      'apikey',
      'model',
      'deepseek',
      'gemini',
      'ollama',
      '测试连接',
      '凭据管理器',
      '模型',
    ],
  },
  {
    id: 'app-update',
    section: 'about',
    title: '应用更新',
    description: '检查新版本、自动后台下载与 GitHub 加速镜像配置',
    keywords: [
      'update',
      'upgrade',
      'mirror',
      'github',
      'sha256',
      'release',
      '更新',
      '检查更新',
      '自动更新',
      '镜像',
      '加速',
      '重启更新',
    ],
  },
  {
    id: 'data-security',
    section: 'about',
    title: '数据与安全说明',
    description: '本地配置目录、Windows 凭据管理器加密与合规说明',
    keywords: ['security', 'privacy', 'localappdata', 'token', 'credential', '数据', '安全', '凭据管理器', '隐私'],
  },
  {
    id: 'about-version',
    section: 'about',
    title: '版本与构建信息',
    description: '查看当前版本号、发布通道、构建提交与构建时间',
    keywords: ['about', 'version', 'commit', 'build', '版本', '构建', '提交', '元数据', '关于'],
  },
  {
    id: 'changelog',
    section: 'about',
    title: '更新日志',
    description: '查看各版本演进记录与完整更新日志弹窗',
    keywords: ['changelog', 'release', 'updates', 'history', '更新日志', '版本记录', '发布说明'],
  },
];

export function searchSettingsEntries(query: string): SettingsSearchEntry[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return [];

  const scored: { entry: SettingsSearchEntry; score: number }[] = [];

  for (const entry of SETTINGS_SEARCH_ENTRIES) {
    const titleLower = entry.title.toLowerCase();
    const descLower = entry.description.toLowerCase();
    const sectionLower = SETTINGS_SECTION_MAP[entry.section].title.toLowerCase();
    const keywordsLower = entry.keywords.map((k) => k.toLowerCase());

    let matchedAll = true;
    let totalScore = 0;

    for (const token of tokens) {
      let tokenScore = 0;
      if (titleLower.includes(token)) {
        tokenScore = titleLower.startsWith(token) ? 120 : 100;
      } else if (keywordsLower.some((kw) => kw.includes(token))) {
        tokenScore = keywordsLower.some((kw) => kw === token) ? 80 : 60;
      } else if (descLower.includes(token)) {
        tokenScore = 30;
      } else if (sectionLower.includes(token)) {
        tokenScore = 15;
      }

      if (tokenScore === 0) {
        matchedAll = false;
        break;
      }
      totalScore += tokenScore;
    }

    if (matchedAll) {
      scored.push({ entry, score: totalScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.entry);
}
