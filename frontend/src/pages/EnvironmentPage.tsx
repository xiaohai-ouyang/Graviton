import React from 'react';
import { Layers } from 'lucide-react';

export const EnvironmentPage: React.FC = () => {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-neutral-200/80 bg-card/80 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3.5">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
              环境
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              管理本机开发环境与相关配置
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-card/50 p-12 text-center dark:border-neutral-800 dark:bg-neutral-900/30">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            <Layers className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-neutral-800 dark:text-neutral-200">
            「环境」页面已就绪
          </h3>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            路由与侧边栏导航已配置完成，后续可在此扩展环境检测与配置功能。
          </p>
        </div>
      </main>
    </>
  );
};
