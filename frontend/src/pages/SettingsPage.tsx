import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  FileClock,
  FolderOpen,
  GitCommitHorizontal,
  Layers,
  Loader2,
  MonitorCheck,
  Palette,
  Shield,
  Sparkles,
} from 'lucide-react';
import { useAccountStore } from '../store/useAccountStore';
import { useAppInfoStore } from '../store/useAppInfoStore';
import { useEnvStore } from '../store/useEnvStore';
import { ThemeToggle } from '../components/ThemeToggle';
import {
  ChangeItemRow,
  CHANNEL_META,
} from '../components/ChangelogModal';
import { AIConfig } from '../types';

export const SettingsPage: React.FC = () => {
  const {
    clientPath,
    loadClientPath,
    selectClientPath,
    widgetAlwaysOnTop,
    loadWidgetAlwaysOnTop,
    setWidgetAlwaysOnTop,
  } = useAccountStore();

  const { aiConfig, loadAIConfig, saveAIConfig, testAIConfig } = useEnvStore();
  const { appInfo, changelog, loadAppInfo, openChangelog } = useAppInfoStore();
  const [aiForm, setAiForm] = useState<AIConfig>({
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  });
  const [showKey, setShowKey] = useState(false);
  const [testingAI, setTestingAI] = useState(false);
  const [savingAI, setSavingAI] = useState(false);
  const [expandedReleases, setExpandedReleases] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadClientPath();
    loadWidgetAlwaysOnTop();
    void loadAIConfig();
    void loadAppInfo();
  }, [loadClientPath, loadWidgetAlwaysOnTop, loadAIConfig, loadAppInfo]);

  useEffect(() => {
    if (aiConfig) {
      setAiForm(aiConfig);
    }
  }, [aiConfig]);

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-neutral-200/80 bg-card/80 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3.5">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              设置
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              配置客户端路径、界面主题与查看数据安全说明
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-5 px-6 py-6">
        {/* Client Path Card */}
        <section className="rounded-2xl border border-neutral-200/80 bg-card p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex items-center gap-2.5 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
              <MonitorCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                客户端路径
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                默认自动探测本机运行进程或标准安装目录。若安装于非标准目录，可在此手动指定。
              </p>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Antigravity 可执行文件路径
            </label>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                readOnly
                value={clientPath || '自动探测 (默认路径)'}
                placeholder="未指定自定义路径，系统将自动探测"
                className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-800 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
              />
              <button
                type="button"
                onClick={selectClientPath}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-300 bg-card px-3.5 py-2 text-xs font-medium text-neutral-700 shadow-xs transition-colors hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span>浏览...</span>
              </button>
            </div>
          </div>
        </section>

        {/* Appearance Card */}
        <section className="rounded-2xl border border-neutral-200/80 bg-card p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                <Palette className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  界面外观
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  选择跟随系统、浅色或深色主题模式
                </p>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </section>

        {/* Floating Widget Card */}
        <section className="rounded-2xl border border-neutral-200/80 bg-card p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                <Layers className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  悬浮窗
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  控制桌面悬浮窗是否始终置顶于其他窗口之上（关闭后可避免遮挡鼠标点击）
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={widgetAlwaysOnTop}
              aria-label="悬浮窗置顶"
              onClick={() => void setWidgetAlwaysOnTop(!widgetAlwaysOnTop)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-hidden ${
                widgetAlwaysOnTop
                  ? 'bg-neutral-900 dark:bg-neutral-100'
                  : 'bg-neutral-200 dark:bg-neutral-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform dark:bg-neutral-900 ${
                  widgetAlwaysOnTop ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </section>

        {/* AI Assistant Card */}
        <section className="rounded-2xl border border-neutral-200/80 bg-card p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  轻量 AI 指令助手（可选）
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  配置 OpenAI 兼容接口（如 DeepSeek、Gemini、Ollama），导入项目时后台自动优化中文命名与核心指令推荐
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={aiForm.enabled}
              aria-label="启用 AI 助手"
              onClick={() => setAiForm((f) => ({ ...f, enabled: !f.enabled }))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-hidden ${
                aiForm.enabled
                  ? 'bg-neutral-900 dark:bg-neutral-100'
                  : 'bg-neutral-200 dark:bg-neutral-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition-transform dark:bg-neutral-900 ${
                  aiForm.enabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Base URL
              </label>
              <input
                type="text"
                value={aiForm.baseUrl}
                onChange={(e) => setAiForm((f) => ({ ...f, baseUrl: e.target.value }))}
                placeholder="https://api.openai.com/v1 或 http://localhost:11434/v1"
                className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                API Key
              </label>
              <div className="relative mt-1.5">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={aiForm.apiKey}
                  onChange={(e) => setAiForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="sk-...（本地 Ollama 可留空）"
                  className="w-full rounded-lg border border-neutral-200 bg-neutral-50 py-2 pr-9 pl-3 font-mono text-xs text-neutral-800 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute inset-y-0 right-2 flex items-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
                模型名称
              </label>
              <input
                type="text"
                value={aiForm.model}
                onChange={(e) => setAiForm((f) => ({ ...f, model: e.target.value }))}
                placeholder="gpt-4o-mini / deepseek-chat / qwen2.5:7b"
                className="mt-1.5 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-800 focus:border-neutral-400 focus:outline-hidden dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
              API Key 加密存储于本机 Windows 凭据管理器
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={testingAI}
                onClick={async () => {
                  setTestingAI(true);
                  await testAIConfig(aiForm);
                  setTestingAI(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-card px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
              >
                {testingAI && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>测试连接</span>
              </button>
              <button
                type="button"
                disabled={savingAI}
                onClick={async () => {
                  setSavingAI(true);
                  await saveAIConfig(aiForm);
                  setSavingAI(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {savingAI ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                <span>保存配置</span>
              </button>
            </div>
          </div>
        </section>

        {/* Data & Security Card */}
        <section className="rounded-2xl border border-neutral-200/80 bg-card p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex items-center gap-2.5 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
              <Shield className="h-4 w-4" />
            </div>
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              数据与安全说明
            </h3>
          </div>

          <ul className="mt-3.5 list-inside list-disc space-y-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            <li>
              账号与额度持久化于{' '}
              <code className="rounded bg-neutral-200/70 px-1.5 py-0.5 text-[11px] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                %LOCALAPPDATA%\CodeTool
              </code>
            </li>
            <li>敏感 Token 仅保存在本机 Windows 凭据管理器，不会上传至第三方服务器</li>
            <li>首版原生支持 Antigravity 经典桌面版热切号与重启</li>
          </ul>
        </section>

        {/* About & Changelog Card */}
        <section className="rounded-2xl border border-neutral-200/80 bg-card p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3.5 dark:border-neutral-800">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                <FileClock className="h-4 w-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    关于与更新日志
                  </h3>
                  {appInfo && (
                    <>
                      <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                        v{appInfo.version}
                      </span>
                      <span
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                          (CHANNEL_META[appInfo.channel] || CHANNEL_META.dev).badgeClass
                        }`}
                      >
                        {(CHANNEL_META[appInfo.channel] || CHANNEL_META.dev).label}
                      </span>
                    </>
                  )}
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  查看当前构建元数据与各版本功能演进记录
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={openChangelog}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-card px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-2xs transition-colors hover:bg-neutral-50 active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <FileClock className="h-3.5 w-3.5" />
              <span>弹窗查看完整日志</span>
            </button>
          </div>

          {appInfo && (
            <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400">当前版本</div>
                <div className="mt-1 font-mono text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                  v{appInfo.version}
                </div>
              </div>
              <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                <div className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  <GitCommitHorizontal className="h-3 w-3" />
                  <span>构建提交</span>
                </div>
                <div className="mt-1 font-mono text-xs font-medium text-neutral-800 dark:text-neutral-200">
                  {appInfo.commit === 'dev' ? '本地开发构建' : appInfo.commit}
                </div>
              </div>
              <div className="rounded-xl border border-neutral-200/70 bg-neutral-50/70 px-3 py-2.5 dark:border-neutral-800 dark:bg-neutral-800/40">
                <div className="flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  <Clock className="h-3 w-3" />
                  <span>构建时间</span>
                </div>
                <div className="mt-1 truncate font-mono text-xs font-medium text-neutral-800 dark:text-neutral-200">
                  {appInfo.buildTime === 'dev'
                    ? '未注入（开发模式）'
                    : new Date(appInfo.buildTime).toLocaleString()}
                </div>
              </div>
            </div>
          )}

          {changelog.length > 0 && (
            <div className="mt-4 space-y-2.5">
              {changelog.map((release, index) => {
                const isExpanded =
                  expandedReleases[release.version] ?? index === 0;
                const relChannel =
                  CHANNEL_META[release.channel] || CHANNEL_META.stable;

                return (
                  <div
                    key={release.version}
                    className="overflow-hidden rounded-xl border border-neutral-200/80 dark:border-neutral-800"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedReleases((prev) => ({
                          ...prev,
                          [release.version]: !isExpanded,
                        }))
                      }
                      className="flex w-full items-center justify-between gap-3 bg-neutral-50/70 px-3.5 py-2.5 text-left transition-colors hover:bg-neutral-100/80 dark:bg-neutral-800/40 dark:hover:bg-neutral-800/70"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-neutral-900 dark:text-neutral-100">
                          v{release.version}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${relChannel.badgeClass}`}
                        >
                          {relChannel.label}
                        </span>
                        {release.title && (
                          <span className="truncate text-xs text-neutral-600 dark:text-neutral-300">
                            {release.title}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {release.date}
                        </span>
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                        />
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-neutral-200/70 px-3.5 py-3 dark:border-neutral-800">
                        {release.summary && (
                          <p className="mb-2.5 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                            {release.summary}
                          </p>
                        )}
                        <ul className="space-y-1.5">
                          {release.changes.map((c, idx) => (
                            <ChangeItemRow
                              key={`${release.version}-settings-${idx}`}
                              change={c}
                            />
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
};
