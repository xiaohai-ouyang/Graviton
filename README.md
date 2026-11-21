# Graviton · 轻量级 Antigravity 额度查询与多账号管理工具

[![Go](https://img.shields.io/badge/Go-1.27+-00ADD8?style=flat&logo=go)](https://go.dev/)
[![Wails v2](https://img.shields.io/badge/Wails-v2.17+-DF1A29?style=flat)](https://wails.io/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react)](https://react.dev/)
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC_BY--NC--SA_4.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

**Graviton** 是一款专为 Windows 桌面打造的**轻量、纯粹合规**的 Antigravity 额度查询与多账号管理工具（同时内置轻量本地开发环境托管与桌面悬浮窗）。你可以一键收录本机已登录账号、通过 OAuth 或 Refresh Token 导入账号、无缝热切换客户端账号，并实时监控各模型组及计费窗口的剩余额度与重置时间。

> **定位说明**：与 [Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) 相比，Graviton **严格不包含任何反向代理（反代）功能**（遵守 Antigravity 使用规范），专注本地账号切换、导入与配额查询，并基于 Go + Wails 原生架构实现更低的体积与内存占用。

### 下载与版本渠道说明

请前往 GitHub **Releases** 页面下载对应版本：

| 渠道 | GitHub 标签 | 版本号格式 | 适用人群与特征 |
| --- | --- | --- | --- |
| **正式版（Stable）** | `Latest` | `vX.Y.Z`（如 `v0.1.0`） | 推荐大多数用户日常稳定使用；应用窗口标题为 `Graviton` |
| **候选测试版（RC）** | `Pre-release` | `vX.Y.Z-rc.N`（如 `v0.1.0-rc.3`） | 正式发布前的功能冻结验收版，适合提前体验与反馈；窗口标题带 `(RC)` 标识，侧边栏与设置页显示 `RC 候选版` 徽章 |

每个版本均同时提供：
- `Graviton-v<版本>-windows-amd64-installer.exe`：标准 Windows 安装包（自动检测 WebView2 运行时并创建快捷方式）
- `Graviton-v<版本>-windows-amd64-portable.exe`：免安装单文件便携版（开箱即用）
- `SHA256SUMS.txt`：可执行文件 SHA-256 校验和

---

## 1. 技术栈与架构设计

- **后端桌面框架**：Go + [Wails v2](https://wails.io/)。Go 负责 Windows 凭据管理、原子持久化、OAuth 刷新、额度聚合与进程生命周期控制。启用 Wails 单实例锁与 Windows WebView2 集成。
- **前端技术栈**：React 19、TypeScript、Vite 7、pnpm、Tailwind CSS v4。
  - 组件库遵循 **shadcn/ui Nova** 风格与 Radix 基础组件，Neutral 中性色彩，自适应系统深浅色主题。
  - 图标采用 **Lucide**。
  - 过渡动效使用 `motion/react`，严格遵循系统 `prefers-reduced-motion` 减少动态效果设置。
  - 状态管理采用 **Zustand**，集中纳管账号展示、并发刷新与操作锁状态。
- **存储方案**：
  - 应用配置与快照：TOML（`github.com/pelletier/go-toml/v2`）。
  - 敏感凭据：Windows 凭据管理器（Win32 Credential API `advapi32.dll`），凭据始终留在 Go 进程与系统受保护凭据库中，绝不透传至前端界面。
  - 旧版客户端存储：SQLite 数据库（`modernc.org/sqlite` + `database/sql`），纯 Go 实现，无 CGO 依赖。

---

## 2. 数据存储位置

- **数据根目录**：`%LOCALAPPDATA%\Graviton`（首次启动会自动兼容迁移旧版 `%LOCALAPPDATA%\CodeTool` 数据文件）
- **账号列表文件**：`%LOCALAPPDATA%\Graviton\accounts.toml`
  - 保存格式版本（`format_version`）、账号 ID、邮箱、显示名称、创建时间、最近切换记录以及最新额度快照（分组窗口、模型列表、总剩余比例、重置时间）。
  - 账号严格按照收录顺序展示。
- **设置文件**：`%LOCALAPPDATA%\Graviton\settings.toml`
  - 保存客户端自定义覆盖路径（`client_path`）、悬浮窗与可选 AI 助手配置。
- **系统凭据库**：
  - 各收录账号独立凭据：`Graviton/Antigravity/<account-id>`（自动兼容读取并迁移旧版 `CodeTool/Antigravity/<account-id>`）
  - 现代客户端（≥ 2.0.0）当前激活凭据：`gemini:antigravity`
- **旧版客户端本地数据库**：
  - `%APPDATA%\Antigravity\User\globalStorage\state.vscdb`
  - 便携版路径：`<client_dir>\..\data\user-data\User\globalStorage\state.vscdb`

---

## 3. 客户端兼容性与切换机制

首版全面兼容经典桌面版 Antigravity 的新旧登录体系：

### 3.1 新版经典客户端（≥ 2.0.0）
- **凭据读取与写入**：通过 Win32 Credential API 读写 `gemini:antigravity`。
- **热切换（Hot Switch）**：
  1. 当 Antigravity 正在运行时，先写入目标账号新凭据到系统凭据库；
  2. 精准定位 Antigravity 主进程后代中的 `language_server.exe` 语言服务子进程并强制终止（保留主窗口与编辑器未保存内容）；
  3. 补写一次凭据权威值以消除竞态；
  4. 有界等待（最长 15 秒）Antigravity 内置 supervisor 自动拉起新的语言服务子进程；
  5. 若子进程成功原地重启，热切换圆满完成，主会话无缝加载新账号。
- **降级完整重启**：
  - 若未检测到语言服务子进程或重启超时，则对客户端主进程执行安全退出（`taskkill /F /T`），重新断言凭据后按捕获的路径和参数拉起客户端。
- **离线切换**：
  - 若客户端未运行，写入凭据后直接拉起客户端。

### 3.2 旧版客户端（< 2.0.0）
- **数据库注入**：
  1. 提示并关闭正在运行的 Antigravity 进程；
  2. 验证 `state.vscdb` SQLite 数据库结构（确保 `ItemTable` 存在）；
  3. 创建数据库快照备份 `state.vscdb.backup`；
  4. 在事务中更新 `antigravityUnifiedStateSync.oauthToken` 与 `antigravityUnifiedStateSync.userStatus`（Protobuf 序列化结构），并写入 `antigravityOnboarding = true`；
  5. 提交事务后重新启动客户端。

---

## 4. 健壮性与失败恢复机制

1. **TOML 文件损坏保护**：
   - 启动或读取 `accounts.toml` / `settings.toml` 时，若发现文件损坏或格式版本高于当前工具支持上限，工具**不会闪退**，而是自动将损坏文件重命名备份为 `<file>.corrupt.<timestamp>` 并汇报原因，安全初始化空列表。
2. **原子文件写入**：
   - 保存时先写入同目录下的 `.tmp` 临时文件，执行 `Sync()` 强制刷盘后关闭，再通过 Windows `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` 进行原子替换，杜绝断电或崩溃导致的半写坏文件。
3. **凭据事务保护**：
   - 收录账号：先写入独立系统凭据，再提交 TOML。若 TOML 写入失败，自动回滚清理新建的独立凭据。
   - 删除账号：先更新并原子提交 TOML 列表，再清理独立凭据。
4. **SQLite 事务回滚**：
   - 旧版数据库修改在事务内执行，发生任何错误立即回滚并从 `.backup` 备份文件还原原始数据库。
5. **并发操作互斥**：
   - 内部维护全局操作锁，防止收录、刷新、切换和删除请求并发冲突。重叠请求立即返回 `{code: "BUSY", message: "系统正在处理其他操作，请稍候"}`。
   - 批量刷新内部限制最多 5 个并发协程，全部拉取完成后一次性合并并单次写盘。
6. **网络与接口退避**：
   - 三级候选端点回退机制：`Daily` ➔ `Sandbox` ➔ `Prod`。
   - 401 自动执行一次强制 Token 刷新并重试；403/429/网络中断保留上次成功快照并在界面给出明确提示；`invalid_grant` 引导用户在客户端重新登录。

---

## 5. 编译与打包

### 环境要求
- Windows 10 / 11 64-bit
- Go 1.27+
- Node.js 20+ & pnpm 11+
- Wails CLI v2.17+
- NSIS 3.10+（用于生成安装包）

### 运行测试
```powershell
# 运行全部 Go 单元测试（凭据、持久化、OAuth、额度、客户端注入）
go test -v ./...

# 前端类型检查与生产构建
cd frontend
pnpm build
cd ..
```

### 构建桌面应用与安装包
```powershell
# 1. 本地调试打包（仅验证构建，不产生 Git 提交与 Tag）
.\scripts\release.ps1 -NoGit

# 2. 规范发包（校验 SemVer 与 changelog.json -> 同步配置 -> 跑测试 -> 提交 -> 编译打包 -> 归档 -> 打 Tag，不自动 push）
.\scripts\release.ps1 -Version 0.1.0-rc.1
```

归档产物位于 `dist\v<版本>\`：
- Windows 安装程序：`dist\v<版本>\Graviton-v<版本>-windows-amd64-installer.exe`
- 便携可执行文件：`dist\v<版本>\Graviton-v<版本>-windows-amd64-portable.exe`
- 完整性校验文件：`dist\v<版本>\SHA256SUMS.txt`

---

## 6. 版本规范、更新日志与发包流程

### 6.1 版本号语义（SemVer 双通道）
Graviton 采用 **正式版（`X.Y.Z`）+ 候选版（`X.Y.Z-rc.N`）** 双通道语义化版本规范：

| 格式示例 | 含义与适用场景 |
| --- | --- |
| `0.1.0` -> `0.1.1`（`PATCH`） | 纯 Bug 修复、稳定性或性能小修，不新增大功能、不破坏配置结构 |
| `0.1.0` -> `0.2.0`（`MINOR`） | 新增完整功能模块或明显新特性且向下兼容旧配置 |
| `0.x.y` -> `1.0.0`（`MAJOR`） | 产品进入稳定里程碑，或存在不向后兼容的数据/配置结构大改 |
| `0.1.1-rc.1`（`RC 候选版`） | `0.1.1` 正式发包前的功能冻结验收包；验收通过后转正为 `0.1.1`，若有修复则递增 `0.1.1-rc.2` |

> **Windows 四段版本号映射**：Windows Manifest 与 NSIS `VIProductVersion` 仅支持纯数字 `X.Y.Z.0`。发包脚本会自动从 `VERSION` 提取纯数字 `X.Y.Z` 写入 `wails.json`，同时将完整 SemVer（如 `0.1.0-rc.1`）同步至 `frontend/package.json`、Go `-ldflags`、Git Tag、归档文件名及应用内界面展示。

### 6.2 单一真相源与更新日志维护
- **`VERSION`**：版本号唯一真相源（仅存放一行如 `0.1.0-rc.1`）。
- **`changelog.json`**：结构化更新日志源数据，Go 通过 `//go:embed` 编译期嵌入并向前端提供强类型接口（侧边栏版本徽章与设置页「关于与更新日志」均可查看）。
  - 变更类型（`type`）支持：`feat`（新增）、`fix`（修复）、`perf`（优化）、`change`（变更）、`breaking`（重大变更）。
- **`CHANGELOG.md`**：由 `scripts/release.ps1` 根据 `changelog.json` 自动生成，请勿手动编辑。

### 6.3 标准发包步骤
1. 在根目录 `changelog.json` 的 `releases` 首位新增目标版本条目（如 `0.1.0-rc.1` 或 `0.1.0`）。
2. 执行 `.\scripts\release.ps1 -Version <目标版本>`（可先加 `-DryRun` 预览，或 `-SyncOnly` 仅同步文件与生成 `CHANGELOG.md`）。
3. 验收 `dist\v<版本>\` 中的安装包与便携版；确认无误后手动执行 `git push && git push origin v<版本>`，若已关联 GitHub 仓库，`.github/workflows/release.yml` 将自动构建并发布 GitHub Release（`-rc.` 标签自动标记为 Pre-release）。

---

## 7. 移植来源与开源许可证

本项目核心 OAuth 流程、Google Cloud Code Quota Summary 解析规范、Base64 哨兵机制以及 Antigravity 客户端进程定位/SQLite 注入逻辑移植自开源项目：

- **上游项目**：[lbjlaq/Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager)
- **固定基线提交**：[`0067fe045ddd77f4462ea8e2c25384839d869f32`](https://github.com/lbjlaq/Antigravity-Manager/commit/0067fe045ddd77f4462ea8e2c25384839d869f32) (Release v5.0.0)
- **开源许可证**：遵循 [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)](https://creativecommons.org/licenses/by-nc-sa/4.0/) 许可证。
