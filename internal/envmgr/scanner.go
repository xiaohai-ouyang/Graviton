package envmgr

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"codetool/internal/storage"

	"github.com/google/uuid"
)

// ScanResult holds the detected tech stacks and extracted commands for a project directory.
type ScanResult struct {
	Name      string
	TechStack []string
	Commands  []storage.ProjectCommand
}

type packageJSON struct {
	Name            string            `json:"name"`
	PackageManager  string            `json:"packageManager"`
	Workspaces      any               `json:"workspaces"`
	Scripts         map[string]string `json:"scripts"`
	Dependencies    map[string]string `json:"dependencies"`
	DevDependencies map[string]string `json:"devDependencies"`
}

var commonSubDirs = []string{
	"frontend", "backend", "server", "web", "client",
	"app", "desktop", "agent", "api", "ui",
}

var skipDirNames = map[string]bool{
	"node_modules": true,
	".git":         true,
	"dist":         true,
	"build":        true,
	"target":       true,
	".venv":        true,
	"venv":         true,
	"vendor":       true,
	".next":        true,
	".turbo":       true,
}

// ScanProject scans rootPath and common first-level subdirectories (and apps/*)
// to extract tech stack tags and executable dev/build/test commands.
func ScanProject(rootPath string) (*ScanResult, error) {
	absRoot, err := filepath.Abs(rootPath)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(absRoot)
	if err != nil || !info.IsDir() {
		return nil, os.ErrNotExist
	}

	res := &ScanResult{
		Name:      filepath.Base(absRoot),
		TechStack: []string{},
		Commands:  []storage.ProjectCommand{},
	}

	stackSet := make(map[string]bool)
	addStack := func(s string) {
		if s != "" && !stackSet[s] {
			stackSet[s] = true
			res.TechStack = append(res.TechStack, s)
		}
	}

	// Scan root directory
	rootHasWails := fileExists(filepath.Join(absRoot, "wails.json"))
	rootHasWorkspaces := false
	if pkg, ok := readPackageJSON(filepath.Join(absRoot, "package.json")); ok {
		rootHasWorkspaces = pkg.Workspaces != nil
	}

	scanSingleDir(absRoot, "", true, rootHasWails, addStack, &res.Commands)

	// Scan common first-level subdirectories
	for _, sub := range commonSubDirs {
		subPath := filepath.Join(absRoot, sub)
		if dirExists(subPath) {
			// If root is Wails or a monorepo with workspaces, keep sub-project commands unpinned by default
			pinSub := !rootHasWails && !rootHasWorkspaces
			scanSingleDir(subPath, sub, pinSub, false, addStack, &res.Commands)
		}
	}

	// Scan apps/* if apps/ exists and root doesn't already cover them with workspaces
	appsDir := filepath.Join(absRoot, "apps")
	if dirExists(appsDir) && !rootHasWorkspaces {
		entries, err := os.ReadDir(appsDir)
		if err == nil {
			for _, ent := range entries {
				if !ent.IsDir() || skipDirNames[ent.Name()] || strings.HasPrefix(ent.Name(), ".") {
					continue
				}
				rel := filepath.ToSlash(filepath.Join("apps", ent.Name()))
				scanSingleDir(filepath.Join(appsDir, ent.Name()), rel, true, false, addStack, &res.Commands)
			}
		}
	}

	// Deduplicate commands by (command, cwd)
	res.Commands = dedupCommands(res.Commands)

	return res, nil
}

func scanSingleDir(
	dirPath string,
	relCwd string,
	allowPin bool,
	isWailsRoot bool,
	addStack func(string),
	cmds *[]storage.ProjectCommand,
) {
	isRoot := relCwd == ""
	subLabel := relCwd

	// 1. Wails
	hasWails := fileExists(filepath.Join(dirPath, "wails.json"))
	if hasWails {
		addStack("Wails")
		*cmds = append(*cmds,
			newRuleCommand("启动开发", "wails dev", relCwd, "dev", allowPin, subLabel),
			newRuleCommand("打包构建", "wails build", relCwd, "build", allowPin, subLabel),
		)
	}

	// 2. Tauri
	hasTauri := fileExists(filepath.Join(dirPath, "tauri.conf.json")) ||
		fileExists(filepath.Join(dirPath, "src-tauri", "tauri.conf.json"))
	if hasTauri {
		addStack("Tauri")
	}

	// 3. Node / Bun / pnpm / Yarn (package.json)
	if pkg, ok := readPackageJSON(filepath.Join(dirPath, "package.json")); ok {
		pm := detectPackageManager(dirPath, pkg)
		switch pm {
		case "bun":
			addStack("Bun")
		case "pnpm":
			addStack("pnpm")
		case "yarn":
			addStack("Yarn")
		default:
			addStack("Node.js")
		}
		if fileExists(filepath.Join(dirPath, "tsconfig.json")) {
			addStack("TypeScript")
		}
		detectFrontendFrameworks(pkg, addStack)

		extractNodeScripts(pkg, pm, relCwd, allowPin && !hasWails, subLabel, cmds)
	}

	// 4. Go (go.mod)
	if fileExists(filepath.Join(dirPath, "go.mod")) {
		addStack("Go")
		if !hasWails && !isWailsRoot {
			if fileExists(filepath.Join(dirPath, "main.go")) {
				*cmds = append(*cmds,
					newRuleCommand(withSubPrefix("运行服务", subLabel), "go run .", relCwd, "dev", allowPin, subLabel),
				)
			}
			*cmds = append(*cmds,
				newRuleCommand(withSubPrefix("编译构建", subLabel), "go build ./...", relCwd, "build", false, subLabel),
				newRuleCommand(withSubPrefix("运行测试", subLabel), "go test ./...", relCwd, "test", false, subLabel),
			)
		} else if isRoot && hasWails {
			*cmds = append(*cmds,
				newRuleCommand("运行 Go 测试", "go test ./...", relCwd, "test", false, subLabel),
			)
		}
	}

	// 5. Rust (Cargo.toml)
	if fileExists(filepath.Join(dirPath, "Cargo.toml")) {
		addStack("Rust")
		if hasTauri {
			*cmds = append(*cmds,
				newRuleCommand(withSubPrefix("启动 Tauri 开发", subLabel), "cargo tauri dev", relCwd, "dev", allowPin, subLabel),
				newRuleCommand(withSubPrefix("Tauri 打包", subLabel), "cargo tauri build", relCwd, "build", allowPin, subLabel),
			)
		} else {
			*cmds = append(*cmds,
				newRuleCommand(withSubPrefix("运行 Rust 项目", subLabel), "cargo run", relCwd, "dev", allowPin, subLabel),
				newRuleCommand(withSubPrefix("Release 编译", subLabel), "cargo build --release", relCwd, "build", false, subLabel),
				newRuleCommand(withSubPrefix("运行测试", subLabel), "cargo test", relCwd, "test", false, subLabel),
			)
		}
	}

	// 6. Python
	scanPythonDir(dirPath, relCwd, allowPin, subLabel, addStack, cmds)

	// 7. Makefile (root only)
	if isRoot && fileExists(filepath.Join(dirPath, "Makefile")) {
		addStack("Make")
		extractMakefileTargets(filepath.Join(dirPath, "Makefile"), relCwd, cmds)
	}

	// 8. Docker Compose (root only)
	if isRoot {
		for _, dc := range []string{"docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"} {
			if fileExists(filepath.Join(dirPath, dc)) {
				addStack("Docker")
				*cmds = append(*cmds,
					newRuleCommand("启动容器服务", "docker compose up -d", relCwd, "dev", false, ""),
					newRuleCommand("停止容器服务", "docker compose down", relCwd, "other", false, ""),
				)
				break
			}
		}
	}
}

func scanPythonDir(
	dirPath string,
	relCwd string,
	allowPin bool,
	subLabel string,
	addStack func(string),
	cmds *[]storage.ProjectCommand,
) {
	hasManifest := false
	for _, mf := range []string{
		"pyproject.toml",
		"requirements.txt",
		"setup.py",
		"setup.cfg",
		"Pipfile",
		"environment.yml",
		"uv.lock",
		"poetry.lock",
	} {
		if fileExists(filepath.Join(dirPath, mf)) {
			hasManifest = true
			break
		}
	}

	venvRunner := detectPythonVenv(dirPath)
	hasManage := fileExists(filepath.Join(dirPath, "manage.py"))

	standardEntries := []string{"main.py", "app.py", "run.py", "server.py", "start.py"}
	foundEntries := make([]string, 0, 2)
	for _, entry := range standardEntries {
		if fileExists(filepath.Join(dirPath, entry)) {
			foundEntries = append(foundEntries, entry)
		}
	}

	if !hasManifest && venvRunner == "" && !hasManage && len(foundEntries) == 0 {
		return
	}

	addStack("Python")

	pyRunner := "python"
	hasUV := fileExists(filepath.Join(dirPath, "uv.lock"))
	hasPoetry := fileExists(filepath.Join(dirPath, "poetry.lock"))
	hasPipfile := fileExists(filepath.Join(dirPath, "Pipfile.lock")) || fileExists(filepath.Join(dirPath, "Pipfile"))
	switch {
	case hasUV:
		pyRunner = "uv run python"
		addStack("uv")
	case hasPoetry:
		pyRunner = "poetry run python"
		addStack("Poetry")
	case hasPipfile:
		pyRunner = "pipenv run python"
	case venvRunner != "":
		pyRunner = venvRunner
	}

	primaryPinned := allowPin
	if hasManage {
		addStack("Django")
		*cmds = append(*cmds, newRuleCommand(
			withSubPrefix("启动 Django 服务", subLabel),
			pyRunner+" manage.py runserver",
			relCwd,
			"dev",
			primaryPinned,
			subLabel,
		))
		primaryPinned = false
	}

	if len(foundEntries) > 0 {
		for idx, entry := range foundEntries {
			label, cmdStr, fw := buildPythonEntryCommand(dirPath, pyRunner, entry)
			if fw != "" {
				addStack(fw)
			}
			pinned := primaryPinned && idx == 0
			*cmds = append(*cmds, newRuleCommand(
				withSubPrefix(label, subLabel),
				cmdStr,
				relCwd,
				"dev",
				pinned,
				subLabel,
			))
			// Keep at most 2 standard entrypoints to avoid clutter
			if idx >= 1 {
				break
			}
		}
	} else if !hasManage {
		if script := findSinglePythonMainScript(dirPath); script != "" {
			label, cmdStr, fw := buildPythonEntryCommand(dirPath, pyRunner, script)
			if fw != "" {
				addStack(fw)
			}
			*cmds = append(*cmds, newRuleCommand(
				withSubPrefix(label, subLabel),
				cmdStr,
				relCwd,
				"dev",
				primaryPinned,
				subLabel,
			))
		}
	}

	if hasUV {
		*cmds = append(*cmds, newRuleCommand(
			withSubPrefix("同步依赖", subLabel),
			"uv sync",
			relCwd,
			"other",
			false,
			subLabel,
		))
	} else if fileExists(filepath.Join(dirPath, "requirements.txt")) {
		*cmds = append(*cmds, newRuleCommand(
			withSubPrefix("安装依赖", subLabel),
			pyRunner+" -m pip install -r requirements.txt",
			relCwd,
			"other",
			false,
			subLabel,
		))
	}

	if fileExists(filepath.Join(dirPath, "pytest.ini")) || dirExists(filepath.Join(dirPath, "tests")) {
		*cmds = append(*cmds, newRuleCommand(
			withSubPrefix("运行测试", subLabel),
			pyRunner+" -m pytest",
			relCwd,
			"test",
			false,
			subLabel,
		))
	}
}

func detectPythonVenv(dirPath string) string {
	for _, name := range []string{".venv", "venv", "env"} {
		if fileExists(filepath.Join(dirPath, name, "Scripts", "python.exe")) {
			return ".\\" + name + "\\Scripts\\python.exe"
		}
		if fileExists(filepath.Join(dirPath, name, "bin", "python")) {
			return "./" + name + "/bin/python"
		}
	}
	return ""
}

func buildPythonEntryCommand(dirPath, pyRunner, entry string) (label, command, framework string) {
	content := readFileTailOrHead(filepath.Join(dirPath, entry), 16384)
	lower := strings.ToLower(content)

	hasMainGuard := strings.Contains(content, "__name__") && strings.Contains(content, "__main__")
	hasStreamlit := strings.Contains(lower, "import streamlit") || strings.Contains(lower, "from streamlit")
	hasFastAPI := strings.Contains(content, "FastAPI(") || strings.Contains(lower, "from fastapi")
	hasFlask := strings.Contains(content, "Flask(") || strings.Contains(lower, "from flask") || strings.Contains(lower, "import flask")
	hasGradio := strings.Contains(lower, "import gradio") || strings.Contains(lower, "from gradio")
	hasUvicornRun := strings.Contains(lower, "uvicorn.run")

	switch {
	case hasStreamlit:
		return "启动 Streamlit 应用", pyRunner + " -m streamlit run " + entry, "Streamlit"
	case hasFastAPI && !hasMainGuard && !hasUvicornRun:
		stem := strings.TrimSuffix(entry, ".py")
		return "启动 FastAPI 服务", pyRunner + " -m uvicorn " + stem + ":app --reload", "FastAPI"
	case hasFastAPI:
		return "启动 FastAPI 服务", pyRunner + " " + entry, "FastAPI"
	case hasFlask:
		return "启动 Flask 服务", pyRunner + " " + entry, "Flask"
	case hasGradio:
		return "启动 Gradio 应用", pyRunner + " " + entry, "Gradio"
	default:
		return "启动 Python 应用", pyRunner + " " + entry, ""
	}
}

func findSinglePythonMainScript(dirPath string) string {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return ""
	}
	var candidates []string
	for _, ent := range entries {
		if ent.IsDir() {
			continue
		}
		name := ent.Name()
		lower := strings.ToLower(name)
		if !strings.HasSuffix(lower, ".py") ||
			strings.HasPrefix(lower, "_") ||
			strings.HasPrefix(lower, "test_") ||
			strings.HasSuffix(lower, "_test.py") ||
			lower == "setup.py" ||
			lower == "conftest.py" {
			continue
		}
		head := readFileTailOrHead(filepath.Join(dirPath, name), 65536)
		if strings.Contains(head, "__name__") && strings.Contains(head, "__main__") {
			candidates = append(candidates, name)
		}
	}
	if len(candidates) == 1 {
		return candidates[0]
	}
	return ""
}

func readFileTailOrHead(p string, maxBytes int) string {
	data, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	if len(data) <= maxBytes {
		return string(data)
	}
	// Check both head and tail since `if __name__ == "__main__":` is usually at the bottom
	half := maxBytes / 2
	return string(data[:half]) + "\n" + string(data[len(data)-half:])
}

func detectPackageManager(dirPath string, pkg packageJSON) string {
	pmField := strings.ToLower(pkg.PackageManager)
	switch {
	case strings.HasPrefix(pmField, "bun"):
		return "bun"
	case strings.HasPrefix(pmField, "pnpm"):
		return "pnpm"
	case strings.HasPrefix(pmField, "yarn"):
		return "yarn"
	case strings.HasPrefix(pmField, "npm"):
		return "npm"
	}

	if fileExists(filepath.Join(dirPath, "bun.lock")) || fileExists(filepath.Join(dirPath, "bun.lockb")) {
		return "bun"
	}
	if fileExists(filepath.Join(dirPath, "pnpm-lock.yaml")) {
		return "pnpm"
	}
	if fileExists(filepath.Join(dirPath, "yarn.lock")) {
		return "yarn"
	}
	return "npm"
}

func detectFrontendFrameworks(pkg packageJSON, addStack func(string)) {
	hasDep := func(name string) bool {
		if _, ok := pkg.Dependencies[name]; ok {
			return true
		}
		if _, ok := pkg.DevDependencies[name]; ok {
			return true
		}
		return false
	}
	if hasDep("electron") {
		addStack("Electron")
	}
	if hasDep("next") {
		addStack("Next.js")
	}
	if hasDep("react") {
		addStack("React")
	}
	if hasDep("vue") {
		addStack("Vue")
	}
	if hasDep("vite") {
		addStack("Vite")
	}
}

func formatNodeRunCommand(pm, scriptName string) string {
	switch pm {
	case "bun":
		return "bun run " + scriptName
	case "pnpm":
		return "pnpm " + scriptName
	case "yarn":
		return "yarn " + scriptName
	default:
		if scriptName == "start" || scriptName == "test" {
			return "npm " + scriptName
		}
		return "npm run " + scriptName
	}
}

func extractNodeScripts(
	pkg packageJSON,
	pm string,
	relCwd string,
	allowPin bool,
	subLabel string,
	cmds *[]storage.ProjectCommand,
) {
	if len(pkg.Scripts) == 0 {
		return
	}

	names := make([]string, 0, len(pkg.Scripts))
	for k := range pkg.Scripts {
		names = append(names, k)
	}
	sort.Slice(names, func(i, j int) bool {
		pi := scriptPriority(names[i])
		pj := scriptPriority(names[j])
		if pi != pj {
			return pi < pj
		}
		return names[i] < names[j]
	})

	pinnedCount := 0
	for _, scriptName := range names {
		zhName, category, wantPin := translateScriptName(scriptName)
		if !allowPin {
			wantPin = false
		}
		if wantPin {
			if pinnedCount >= 6 {
				wantPin = false
			} else {
				pinnedCount++
			}
		}
		cmdStr := formatNodeRunCommand(pm, scriptName)
		*cmds = append(*cmds, newRuleCommand(withSubPrefix(zhName, subLabel), cmdStr, relCwd, category, wantPin, subLabel))
	}
}

func scriptPriority(name string) int {
	lower := strings.ToLower(name)
	switch {
	case lower == "dev":
		return 1
	case strings.HasPrefix(lower, "dev:"):
		return 2
	case lower == "start" || strings.HasPrefix(lower, "start:"):
		return 3
	case lower == "serve":
		return 4
	case lower == "build":
		return 10
	case strings.HasPrefix(lower, "build:") || strings.HasPrefix(lower, "package:"):
		return 11
	case lower == "preview":
		return 20
	case strings.HasPrefix(lower, "test"):
		return 30
	case lower == "typecheck" || lower == "lint" || strings.HasPrefix(lower, "check"):
		return 40
	default:
		return 50
	}
}

// semanticScriptDict maps common npm/bun script names to clear Chinese labels, categories, and default pin state.
var semanticScriptDict = map[string]struct {
	name     string
	category string
	pinned   bool
}{
	"dev":           {"启动开发", "dev", true},
	"dev:desktop":   {"启动桌面", "dev", true},
	"dev:agent":     {"启动 Agent", "dev", true},
	"dev:web":       {"启动 Web", "dev", true},
	"dev:frontend":  {"启动前端", "dev", true},
	"dev:client":    {"启动客户端", "dev", true},
	"dev:server":    {"启动服务端", "dev", true},
	"dev:backend":   {"启动后端", "dev", true},
	"dev:api":       {"启动 API", "dev", true},
	"dev:renderer":  {"启动渲染端", "dev", true},
	"start":         {"启动服务", "dev", true},
	"serve":         {"启动服务", "dev", true},
	"preview":       {"本地预览", "dev", false},
	"build":         {"打包构建", "build", true},
	"build:desktop": {"构建桌面端", "build", false},
	"build:agent":   {"构建 Agent", "build", false},
	"build:renderer": {"构建渲染端", "build", false},
	"build:win":     {"Windows 打包", "build", true},
	"package:win":   {"Windows 打包", "build", true},
	"package":       {"打包应用", "build", true},
	"test":          {"运行测试", "test", false},
	"test:unit":     {"单元测试", "test", false},
	"test:e2e":      {"端到端测试", "test", false},
	"lint":          {"代码检查", "lint", false},
	"typecheck":     {"类型检查", "lint", false},
	"format":        {"代码格式化", "lint", false},
	"format:check":  {"格式检查", "lint", false},
	"check:quality": {"全量质量检查", "lint", false},
}

func translateScriptName(scriptName string) (name string, category string, pinned bool) {
	lower := strings.ToLower(strings.TrimSpace(scriptName))
	if entry, ok := semanticScriptDict[lower]; ok {
		return entry.name, entry.category, entry.pinned
	}

	switch {
	case strings.HasPrefix(lower, "dev:"):
		suffix := strings.TrimPrefix(scriptName, "dev:")
		return "启动 " + suffix, "dev", true
	case strings.HasPrefix(lower, "start:"):
		suffix := strings.TrimPrefix(scriptName, "start:")
		return "启动 " + suffix, "dev", false
	case strings.HasPrefix(lower, "build:"):
		suffix := strings.TrimPrefix(scriptName, "build:")
		return "构建 " + suffix, "build", false
	case strings.HasPrefix(lower, "package:"):
		suffix := strings.TrimPrefix(scriptName, "package:")
		return "打包 " + suffix, "build", false
	case strings.HasPrefix(lower, "test"):
		return "测试 " + scriptName, "test", false
	case strings.Contains(lower, "lint") || strings.Contains(lower, "check") || strings.Contains(lower, "fmt") || strings.Contains(lower, "format"):
		return scriptName, "lint", false
	default:
		return scriptName, "other", false
	}
}

func extractMakefileTargets(makefilePath, relCwd string, cmds *[]storage.ProjectCommand) {
	data, err := os.ReadFile(makefilePath)
	if err != nil {
		return
	}
	lines := strings.Split(string(data), "\n")
	interesting := map[string]struct {
		name     string
		category string
	}{
		"dev":   {"Make 启动开发", "dev"},
		"run":   {"Make 运行", "dev"},
		"build": {"Make 构建", "build"},
		"test":  {"Make 测试", "test"},
	}
	seen := make(map[string]bool)
	for _, line := range lines {
		if strings.HasPrefix(line, "\t") || strings.HasPrefix(line, " ") || strings.HasPrefix(line, "#") {
			continue
		}
		colonIdx := strings.IndexByte(line, ':')
		if colonIdx <= 0 {
			continue
		}
		target := strings.TrimSpace(line[:colonIdx])
		if strings.ContainsAny(target, " $/.%") || target == ".PHONY" || seen[target] {
			continue
		}
		if info, ok := interesting[strings.ToLower(target)]; ok {
			seen[target] = true
			*cmds = append(*cmds, newRuleCommand(info.name, "make "+target, relCwd, info.category, false, ""))
		}
	}
}

func withSubPrefix(name, subLabel string) string {
	if subLabel == "" {
		return name
	}
	return "[" + subLabel + "] " + name
}

func newRuleCommand(name, command, cwd, category string, pinned bool, subProject string) storage.ProjectCommand {
	return storage.ProjectCommand{
		ID:         uuid.NewString(),
		Name:       name,
		Command:    command,
		Cwd:        cwd,
		Category:   category,
		Pinned:     pinned,
		Source:     "rule",
		SubProject: subProject,
	}
}

func dedupCommands(cmds []storage.ProjectCommand) []storage.ProjectCommand {
	seen := make(map[string]bool, len(cmds))
	out := make([]storage.ProjectCommand, 0, len(cmds))
	for _, c := range cmds {
		key := strings.TrimSpace(c.Cwd) + "::" + strings.TrimSpace(c.Command)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, c)
	}
	return out
}

func readPackageJSON(p string) (packageJSON, bool) {
	data, err := os.ReadFile(p)
	if err != nil {
		return packageJSON{}, false
	}
	var pkg packageJSON
	if err := json.Unmarshal(data, &pkg); err != nil {
		return packageJSON{}, false
	}
	return pkg, true
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}
