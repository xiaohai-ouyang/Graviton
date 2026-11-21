# Security Policy

## 安全设计原则

Graviton 是一款面向 Windows 的轻量级 Antigravity 多账号管理与额度查询工具，遵循以下安全边界：

- **本地优先、无反代**：不包含任何反向代理功能，不搭建中转服务器，不收集或上传用户凭据。
- **凭据隔离**：敏感 OAuth Token 与可选 AI API Key 均通过 Win32 Credential API 存储于本机 Windows 凭据管理器，绝不写入明文配置文件或透传至前端界面。
- **可验证构建**：所有正式发布与候选发布包均由公开的 GitHub Actions 工作流（`.github/workflows/release.yml`）自动构建，并附带 `SHA256SUMS.txt` 与 GitHub SLSA 构建来源证明（Artifact Attestation）。

## 校验安装包未被篡改

下载 GitHub Release 中的 `.exe` 后，建议通过以下两种方式任选其一（或同时）验证完整性与真实来源：

### 1. 使用 GitHub 官方构建来源证明（推荐，防二次打包投毒）

需安装 [GitHub CLI (`gh`)](https://cli.github.com/)：

```powershell
gh attestation verify Graviton-v<版本>-windows-amd64-installer.exe --repo xiaohai-ouyang/Graviton
gh attestation verify Graviton-v<版本>-windows-amd64-portable.exe --repo xiaohai-ouyang/Graviton
```

验证通过即证明该可执行文件由本仓库公开源码在 GitHub Actions 官方环境中直接构建，中途未被任何人替换或注入代码。

### 2. 核对 SHA-256 校验和

```powershell
Get-FileHash .\Graviton-v<版本>-windows-amd64-installer.exe -Algorithm SHA256
```

将输出结果与同版本 Release 中的 `SHA256SUMS.txt` 逐字符比对。

## 漏洞上报

如果你发现任何安全隐患或凭据处理问题，**请勿直接提交公开 Issue**。请通过本仓库的 **Security -> Advisories -> Report a vulnerability**（GitHub Private Vulnerability Reporting）私下上报，维护者将尽快响应并修复。
