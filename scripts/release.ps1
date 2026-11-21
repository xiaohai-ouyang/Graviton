<#
.SYNOPSIS
    Graviton automated versioning, changelog generation, build, and release script.

.DESCRIPTION
    Single Source of Truth: root VERSION + changelog.json.
    Supported SemVer format: X.Y.Z (stable) or X.Y.Z-rc.N (release candidate, N >= 1).

.EXAMPLE
    # Sync VERSION, wails.json, frontend/package.json, and regenerate CHANGELOG.md only
    .\scripts\release.ps1 -SyncOnly

    # Local verification build without creating git commit/tag
    .\scripts\release.ps1 -Version 0.1.0-rc.1 -NoGit

    # Full automated release (validate -> sync -> test -> commit -> build -> archive -> tag)
    .\scripts\release.ps1 -Version 0.1.0-rc.1
#>
[CmdletBinding()]
param(
    [string]$Version = "",
    [switch]$SyncOnly,
    [switch]$NoGit,
    [switch]$SkipTests,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

function Read-Utf8([string]$Path) {
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$WorkingDirectory = $RepoRoot
    )
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
        }
    } finally {
        Pop-Location
    }
}

$VersionFile = Join-Path $RepoRoot "VERSION"
$ChangelogJsonPath = Join-Path $RepoRoot "changelog.json"
$ChangelogMdPath = Join-Path $RepoRoot "CHANGELOG.md"
$WailsJsonPath = Join-Path $RepoRoot "wails.json"
$FrontendPkgPath = Join-Path $RepoRoot "frontend\package.json"
$FrontendPkgMd5Path = Join-Path $RepoRoot "frontend\package.json.md5"
$WailsToolsNshPath = Join-Path $RepoRoot "build\windows\installer\wails_tools.nsh"

# 1. Resolve target version
if ([string]::IsNullOrWhiteSpace($Version)) {
    if (-not (Test-Path $VersionFile)) {
        throw "VERSION file not found at $VersionFile. Pass -Version X.Y.Z or X.Y.Z-rc.N."
    }
    $Version = (Read-Utf8 $VersionFile).Trim()
} else {
    $Version = $Version.Trim()
}

# 2. Validate SemVer (dual-channel: X.Y.Z or X.Y.Z-rc.N)
$SemverRegex = '^(\d+\.\d+\.\d+)(?:-rc\.([1-9]\d*))?$'
if ($Version -notmatch $SemverRegex) {
    throw "Invalid version '$Version'. Expected X.Y.Z (stable) or X.Y.Z-rc.N (N >= 1), e.g. 0.1.0 or 0.1.0-rc.1."
}
$NumericVersion = $Matches[1]
$Channel = if ($Matches[2]) { "rc" } else { "stable" }
$TagName = "v$Version"

Write-Step "Target version: $Version (Windows numeric: $NumericVersion, channel: $Channel)"

# 3. Validate changelog.json and build CHANGELOG.md content
if (-not (Test-Path $ChangelogJsonPath)) {
    throw "changelog.json not found at $ChangelogJsonPath"
}

$ChangelogObj = (Read-Utf8 $ChangelogJsonPath) | ConvertFrom-Json
if ($null -eq $ChangelogObj.releases -or $ChangelogObj.releases.Count -eq 0) {
    throw "changelog.json must contain a non-empty 'releases' array."
}

$ValidChangeTypes = @("breaking", "feat", "perf", "fix", "change")
$TypeHeaders = [ordered]@{
    "breaking" = "重大变更"
    "feat"     = "新增"
    "perf"     = "优化"
    "fix"      = "修复"
    "change"   = "变更"
}

$TargetRelease = $null
$SeenVersions = @{}
$MdLines = New-Object System.Collections.Generic.List[string]
$MdLines.Add("<!-- AUTO-GENERATED FROM changelog.json BY scripts/release.ps1 - DO NOT EDIT DIRECTLY -->")
$MdLines.Add("")
$MdLines.Add("# 更新日志 (Changelog)")
$MdLines.Add("")
$MdLines.Add('本项目遵循语义化版本规范（正式版 `X.Y.Z` / 候选版 `X.Y.Z-rc.N`）。此文件由根目录 [changelog.json](./changelog.json) 自动生成。')
$MdLines.Add("")

foreach ($rel in $ChangelogObj.releases) {
    $rv = ([string]$rel.version).Trim()
    if ($rv -notmatch $SemverRegex) {
        throw "changelog.json contains invalid release version '$rv'."
    }
    if ($SeenVersions.ContainsKey($rv)) {
        throw "changelog.json contains duplicate version '$rv'."
    }
    $SeenVersions[$rv] = $true

    $rdate = ([string]$rel.date).Trim()
    if ([string]::IsNullOrWhiteSpace($rdate)) {
        throw "changelog.json entry '$rv' is missing required field 'date'."
    }
    if ($null -eq $rel.changes -or $rel.changes.Count -eq 0) {
        throw "changelog.json entry '$rv' must contain at least one item in 'changes'."
    }

    if ($rv -eq $Version) {
        $TargetRelease = $rel
    }

    $rChannelLabel = if ($rv -match '-rc\.') { "RC 候选版" } else { "正式版" }
    $rTitle = if ($null -ne $rel.title) { ([string]$rel.title).Trim() } else { "" }
    $rSummary = if ($null -ne $rel.summary) { ([string]$rel.summary).Trim() } else { "" }

    $heading = "## [v$rv] - $rdate ($rChannelLabel)"
    if (-not [string]::IsNullOrWhiteSpace($rTitle)) {
        $heading += " · $rTitle"
    }
    $MdLines.Add($heading)
    $MdLines.Add("")
    if (-not [string]::IsNullOrWhiteSpace($rSummary)) {
        $MdLines.Add("> $rSummary")
        $MdLines.Add("")
    }

    $Grouped = @{}
    foreach ($t in $ValidChangeTypes) {
        $Grouped[$t] = New-Object System.Collections.Generic.List[string]
    }
    foreach ($ch in $rel.changes) {
        $ct = ([string]$ch.type).Trim()
        $ctext = ([string]$ch.text).Trim()
        if ($ValidChangeTypes -notcontains $ct) {
            throw "changelog.json entry '$rv' has invalid change type '$ct'. Allowed: $($ValidChangeTypes -join ', ')"
        }
        if ([string]::IsNullOrWhiteSpace($ctext)) {
            throw "changelog.json entry '$rv' has an empty change text."
        }
        $Grouped[$ct].Add($ctext)
    }

    foreach ($t in $TypeHeaders.Keys) {
        if ($Grouped[$t].Count -gt 0) {
            $MdLines.Add("### $($TypeHeaders[$t])")
            $MdLines.Add("")
            foreach ($item in $Grouped[$t]) {
                $MdLines.Add("- $item")
            }
            $MdLines.Add("")
        }
    }
}

if ($null -eq $TargetRelease) {
    throw "changelog.json does not contain a release entry for version '$Version'. Please add it to changelog.json before releasing."
}

$ChangelogMdContent = ($MdLines -join "`n").TrimEnd() + "`n"

# 4. Pre-flight Git checks (when full git release mode)
if (-not $SyncOnly -and -not $NoGit) {
    Write-Step "Checking Git repository state and tag availability"
    Push-Location $RepoRoot
    try {
        & git rev-parse --verify --quiet "refs/tags/$TagName" *> $null
        if ($LASTEXITCODE -eq 0) {
            throw "Git tag '$TagName' already exists. Bump VERSION (e.g. next -rc.N or PATCH/MINOR) before releasing."
        }

        $AllowedDirtyPaths = @(
            "VERSION",
            "changelog.json",
            "CHANGELOG.md",
            "wails.json",
            "frontend/package.json",
            "frontend/package.json.md5",
            "build/windows/installer/wails_tools.nsh"
        )
        $StatusLines = & git status --porcelain
        foreach ($line in $StatusLines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $path = $line.Substring(3).Trim().Trim('"')
            if ($AllowedDirtyPaths -notcontains $path) {
                throw "Working tree has uncommitted non-release change: '$path'. Please commit or stash code changes before running a full release (or pass -NoGit)."
            }
        }
    } finally {
        Pop-Location
    }
}

if ($DryRun) {
    Write-Host ""
    Write-Host "[DryRun] Planned actions:" -ForegroundColor Yellow
    Write-Host "  - Write VERSION -> $Version"
    Write-Host "  - Sync wails.json info.productVersion -> $NumericVersion"
    Write-Host "  - Sync frontend/package.json version -> $Version"
    Write-Host "  - Regenerate CHANGELOG.md from changelog.json"
    if (-not $SyncOnly) {
        if (-not $SkipTests) { Write-Host "  - Run go test ./..." }
        Write-Host "  - Run frontend pnpm build"
        if (-not $NoGit) { Write-Host "  - Commit release metadata: chore(release): $TagName" }
        Write-Host "  - Run wails build -nsis with ldflags (Version=$Version)"
        Write-Host "  - Archive portable + installer + SHA256SUMS.txt to dist/$TagName/"
        if (-not $NoGit) { Write-Host "  - Create annotated Git tag: $TagName (no push)" }
    }
    exit 0
}

# 5. Sync VERSION, wails.json, frontend/package.json, CHANGELOG.md
Write-Step "Syncing VERSION, wails.json, frontend/package.json, and CHANGELOG.md"
Write-Utf8NoBom $VersionFile "$Version`n"

$WailsContent = Read-Utf8 $WailsJsonPath
if ($WailsContent -notmatch '"productVersion"\s*:\s*"[^"]*"') {
    throw "wails.json is missing info.productVersion field."
}
$WailsUpdated = [regex]::Replace($WailsContent, '("productVersion"\s*:\s*)"[^"]*"', "`${1}`"$NumericVersion`"", 1)
Write-Utf8NoBom $WailsJsonPath $WailsUpdated

$PkgContent = Read-Utf8 $FrontendPkgPath
if ($PkgContent -notmatch '"version"\s*:\s*"[^"]*"') {
    throw "frontend/package.json is missing version field."
}
$PkgUpdated = [regex]::Replace($PkgContent, '("version"\s*:\s*)"[^"]*"', "`${1}`"$Version`"", 1)
Write-Utf8NoBom $FrontendPkgPath $PkgUpdated

$PkgMd5 = (Get-FileHash -Path $FrontendPkgPath -Algorithm MD5).Hash.ToLowerInvariant()
Write-Utf8NoBom $FrontendPkgMd5Path $PkgMd5

if (Test-Path $WailsToolsNshPath) {
    $NshContent = Read-Utf8 $WailsToolsNshPath
    if ($NshContent -match '(!define INFO_PRODUCTVERSION\s+)"[^"]*"') {
        $NshUpdated = [regex]::Replace($NshContent, '(!define INFO_PRODUCTVERSION\s+)"[^"]*"', "`${1}`"$NumericVersion`"", 1)
        Write-Utf8NoBom $WailsToolsNshPath $NshUpdated
    }
}

Write-Utf8NoBom $ChangelogMdPath $ChangelogMdContent

if ($SyncOnly) {
    Write-Host "Sync completed for v$Version." -ForegroundColor Green
    exit 0
}

# 6. Build frontend first (required for Go //go:embed all:frontend/dist on clean checkouts), then run Go tests
Write-Step "Checking frontend TypeScript & production build (pnpm build)"
Invoke-Checked -FilePath "pnpm" -Arguments @("build") -WorkingDirectory (Join-Path $RepoRoot "frontend")

if (-not $SkipTests) {
    Write-Step "Running Go test suite (go test ./...)"
    Invoke-Checked -FilePath "go" -Arguments @("test", "./...")
}

# 7. Commit release metadata before wails build so binary Commit SHA matches release commit
if (-not $NoGit) {
    Write-Step "Committing release metadata for $TagName"
    $ReleaseFiles = @(
        "VERSION",
        "changelog.json",
        "CHANGELOG.md",
        "wails.json",
        "frontend/package.json",
        "frontend/package.json.md5",
        "build/windows/installer/wails_tools.nsh"
    )
    Invoke-Checked -FilePath "git" -Arguments (@("add", "--") + $ReleaseFiles)

    Push-Location $RepoRoot
    try {
        & git diff --cached --quiet
        if ($LASTEXITCODE -ne 0) {
            Invoke-Checked -FilePath "git" -Arguments @("commit", "-m", "chore(release): $TagName")
        } else {
            Write-Host "  (release metadata already committed)" -ForegroundColor DarkGray
        }
    } finally {
        Pop-Location
    }
}

# 8. Build desktop binary & Windows NSIS installer with injected build metadata
$CommitSha = "dev"
Push-Location $RepoRoot
try {
    $gitSha = (& git rev-parse --short HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($gitSha)) {
        $CommitSha = $gitSha.Trim()
    }
} finally {
    Pop-Location
}
$BuildTime = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$LdFlags = "-s -w -X graviton/internal/buildinfo.Version=$Version -X graviton/internal/buildinfo.Commit=$CommitSha -X graviton/internal/buildinfo.BuildTime=$BuildTime"

Write-Step "Building Wails app + NSIS installer (Version=$Version, Commit=$CommitSha, BuildTime=$BuildTime)"
Invoke-Checked -FilePath "wails" -Arguments @("build", "-nsis", "-ldflags", $LdFlags)

# 9. Archive release artifacts and compute SHA-256 checksums
Write-Step "Archiving artifacts to dist/$TagName/"
$BuildBinDir = Join-Path $RepoRoot "build\bin"
$PortableSrc = Join-Path $BuildBinDir "Graviton.exe"
if (-not (Test-Path $PortableSrc)) {
    throw "Expected portable binary not found at $PortableSrc"
}

$InstallerCandidates = @(Get-ChildItem -Path $BuildBinDir -Filter "graviton-*-installer.exe" | Sort-Object LastWriteTime -Descending)
if ($InstallerCandidates.Count -eq 0) {
    throw "Expected NSIS installer (graviton-*-installer.exe) not found in $BuildBinDir"
}
$InstallerSrc = $InstallerCandidates[0].FullName

$DistDir = Join-Path $RepoRoot "dist\$TagName"
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

$PortableName = "Graviton-$TagName-windows-amd64-portable.exe"
$InstallerName = "Graviton-$TagName-windows-amd64-installer.exe"
$PortableDst = Join-Path $DistDir $PortableName
$InstallerDst = Join-Path $DistDir $InstallerName

Copy-Item -Path $PortableSrc -Destination $PortableDst -Force
Copy-Item -Path $InstallerSrc -Destination $InstallerDst -Force

$BinPortableDst = Join-Path $BuildBinDir "Graviton-$TagName.exe"
$BinInstallerDst = Join-Path $BuildBinDir "Graviton-$TagName-installer.exe"
Copy-Item -Path $PortableSrc -Destination $BinPortableDst -Force
Copy-Item -Path $InstallerSrc -Destination $BinInstallerDst -Force

$ChecksumLines = New-Object System.Collections.Generic.List[string]
foreach ($artifactName in @($InstallerName, $PortableName)) {
    $artifactPath = Join-Path $DistDir $artifactName
    $hash = (Get-FileHash -Path $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $ChecksumLines.Add("$hash  $artifactName")
}
$ChecksumsPath = Join-Path $DistDir "SHA256SUMS.txt"
Write-Utf8NoBom $ChecksumsPath (($ChecksumLines -join "`n") + "`n")

# Generate formatted GitHub Release notes (with clear Pre-release notice for RC builds)
$ReleaseNotesLines = New-Object System.Collections.Generic.List[string]
if ($Channel -eq "rc") {
    $ReleaseNotesLines.Add("> [!NOTE]")
    $ReleaseNotesLines.Add('> 当前版本为 **RC 发布候选版（Pre-release）**，用于正式版发布前的提前体验与验收测试。如追求长期稳定使用，请优先下载标记为 `Latest` 的正式版。')
    $ReleaseNotesLines.Add("")
}
if ($null -ne $TargetRelease.title -and -not [string]::IsNullOrWhiteSpace([string]$TargetRelease.title)) {
    $ReleaseNotesLines.Add("## $($TargetRelease.title)")
    $ReleaseNotesLines.Add("")
}
if ($null -ne $TargetRelease.summary -and -not [string]::IsNullOrWhiteSpace([string]$TargetRelease.summary)) {
    $ReleaseNotesLines.Add(([string]$TargetRelease.summary).Trim())
    $ReleaseNotesLines.Add("")
}
foreach ($t in $TypeHeaders.Keys) {
    $items = @($TargetRelease.changes | Where-Object { ([string]$_.type).Trim() -eq $t })
    if ($items.Count -gt 0) {
        $ReleaseNotesLines.Add("### $($TypeHeaders[$t])")
        $ReleaseNotesLines.Add("")
        foreach ($item in $items) {
            $ReleaseNotesLines.Add("- $(([string]$item.text).Trim())")
        }
        $ReleaseNotesLines.Add("")
    }
}
$ReleaseNotesLines.Add("### 下载与防篡改验真")
$ReleaseNotesLines.Add("")
$ReleaseNotesLines.Add("- **标准安装包（推荐）**：``$InstallerName``（自动检测 WebView2 并创建快捷方式）")
$ReleaseNotesLines.Add("- **免安装便携版**：``$PortableName``（单文件直接运行，无需安装）")
$ReleaseNotesLines.Add('- **SHA-256 校验**：`SHA256SUMS.txt`（运行 `Get-FileHash <文件名> -Algorithm SHA256` 核对）')
$ReleaseNotesLines.Add("- **SLSA 构建来源验真**：``gh attestation verify $InstallerName --repo xiaohai-ouyang/Graviton``")
$ReleaseNotesPath = Join-Path $DistDir "RELEASE_NOTES.md"
Write-Utf8NoBom $ReleaseNotesPath (($ReleaseNotesLines -join "`n").TrimEnd() + "`n")

# 10. Create annotated Git tag (no auto-push)
if (-not $NoGit) {
    Write-Step "Creating annotated Git tag $TagName"
    $TagMsg = "Release $TagName"
    if ($null -ne $TargetRelease.title -and -not [string]::IsNullOrWhiteSpace([string]$TargetRelease.title)) {
        $TagMsg += " - $($TargetRelease.title)"
    }
    Invoke-Checked -FilePath "git" -Arguments @("tag", "-a", $TagName, "-m", $TagMsg)
}

Write-Host ""
Write-Host "Release $TagName built successfully!" -ForegroundColor Green
Write-Host "Artifacts:" -ForegroundColor Green
Write-Host "  - $InstallerDst"
Write-Host "  - $PortableDst"
Write-Host "  - $BinInstallerDst"
Write-Host "  - $BinPortableDst"
Write-Host "  - $ChecksumsPath"
if (-not $NoGit) {
    Write-Host ""
    Write-Host "Next step (when ready to publish to remote):" -ForegroundColor Yellow
    Write-Host "  git push && git push origin $TagName"
}
