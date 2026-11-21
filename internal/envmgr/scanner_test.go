package envmgr

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScanProject_WailsAndFrontend(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "wails.json"), []byte(`{"name":"CodeTool"}`), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module codetool\n"), 0644))

	frontendDir := filepath.Join(dir, "frontend")
	require.NoError(t, os.MkdirAll(frontendDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(frontendDir, "pnpm-lock.yaml"), []byte(""), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(frontendDir, "package.json"), []byte(`{
		"name": "frontend",
		"scripts": {
			"dev": "vite",
			"build": "tsc && vite build"
		},
		"dependencies": { "react": "^19.0.0" },
		"devDependencies": { "vite": "^7.0.0" }
	}`), 0644))

	res, err := ScanProject(dir)
	require.NoError(t, err)
	assert.Contains(t, res.TechStack, "Wails")
	assert.Contains(t, res.TechStack, "Go")
	assert.Contains(t, res.TechStack, "pnpm")
	assert.Contains(t, res.TechStack, "React")

	// Wails root commands should be pinned
	var foundWailsDev, foundWailsBuild, foundFrontendDev bool
	for _, c := range res.Commands {
		if c.Command == "wails dev" && c.Cwd == "" {
			foundWailsDev = true
			assert.True(t, c.Pinned)
			assert.Equal(t, "启动开发", c.Name)
		}
		if c.Command == "wails build" && c.Cwd == "" {
			foundWailsBuild = true
			assert.True(t, c.Pinned)
		}
		if c.Command == "pnpm dev" && c.Cwd == "frontend" {
			foundFrontendDev = true
			assert.False(t, c.Pinned)
		}
	}
	assert.True(t, foundWailsDev)
	assert.True(t, foundWailsBuild)
	assert.True(t, foundFrontendDev)
}

func TestScanProject_BunMonorepo(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "bun.lock"), []byte(""), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{
		"name": "pidex",
		"packageManager": "bun@1.4.4",
		"workspaces": ["apps/*", "packages/*"],
		"scripts": {
			"dev": "bun run scripts/Dev.ts",
			"dev:desktop": "bun run scripts/DevDesktop.ts",
			"dev:agent": "bun run scripts/DevAgent.ts",
			"package:win": "bun scripts/PackageWin.ts --x64",
			"lint": "oxlint ."
		}
	}`), 0644))

	res, err := ScanProject(dir)
	require.NoError(t, err)
	assert.Contains(t, res.TechStack, "Bun")

	cmdMap := make(map[string]string)
	pinnedMap := make(map[string]bool)
	for _, c := range res.Commands {
		cmdMap[c.Command] = c.Name
		pinnedMap[c.Command] = c.Pinned
	}
	assert.Equal(t, "启动桌面", cmdMap["bun run dev:desktop"])
	assert.Equal(t, "启动 Agent", cmdMap["bun run dev:agent"])
	assert.Equal(t, "Windows 打包", cmdMap["bun run package:win"])
	assert.True(t, pinnedMap["bun run dev:desktop"])
	assert.True(t, pinnedMap["bun run dev:agent"])
	assert.False(t, pinnedMap["bun run lint"])
}

func TestScanProject_PythonVenvFlaskWithoutManifest(t *testing.T) {
	dir := t.TempDir()
	venvScripts := filepath.Join(dir, ".venv", "Scripts")
	require.NoError(t, os.MkdirAll(venvScripts, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(venvScripts, "python.exe"), []byte(""), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "app.py"), []byte(`from flask import Flask
app = Flask(__name__)
if __name__ == "__main__":
    app.run()
`), 0644))

	res, err := ScanProject(dir)
	require.NoError(t, err)
	assert.Contains(t, res.TechStack, "Python")
	assert.Contains(t, res.TechStack, "Flask")
	require.Len(t, res.Commands, 1)
	assert.Equal(t, "启动 Flask 服务", res.Commands[0].Name)
	assert.Equal(t, `.\.venv\Scripts\python.exe app.py`, res.Commands[0].Command)
	assert.True(t, res.Commands[0].Pinned)
}

func TestScanProject_PythonUVFastAPI(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "pyproject.toml"), []byte("[project]\nname='api'\n"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "uv.lock"), []byte(""), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "main.py"), []byte("from fastapi import FastAPI\napp = FastAPI()\n"), 0644))

	res, err := ScanProject(dir)
	require.NoError(t, err)
	assert.Contains(t, res.TechStack, "Python")
	assert.Contains(t, res.TechStack, "uv")
	assert.Contains(t, res.TechStack, "FastAPI")

	cmdMap := make(map[string]bool)
	for _, c := range res.Commands {
		cmdMap[c.Command] = c.Pinned
	}
	assert.True(t, cmdMap["uv run python -m uvicorn main:app --reload"])
	assert.Contains(t, cmdMap, "uv sync")
	assert.False(t, cmdMap["uv sync"])
}

func TestScanProject_PythonCustomMainScript(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "requirements.txt"), []byte("flask\n"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "helper.py"), []byte("def add(a, b): return a + b\n"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "webui.py"), []byte("if __name__ == '__main__':\n    print('ok')\n"), 0644))

	res, err := ScanProject(dir)
	require.NoError(t, err)
	assert.Contains(t, res.TechStack, "Python")

	var foundRun, foundInstall bool
	for _, c := range res.Commands {
		if c.Command == "python webui.py" {
			foundRun = true
			assert.True(t, c.Pinned)
		}
		if c.Command == "python -m pip install -r requirements.txt" {
			foundInstall = true
			assert.False(t, c.Pinned)
		}
	}
	assert.True(t, foundRun)
	assert.True(t, foundInstall)
}

func TestScanProjectForShell_GitBashPythonVenv(t *testing.T) {
	dir := t.TempDir()
	venvScripts := filepath.Join(dir, ".venv", "Scripts")
	require.NoError(t, os.MkdirAll(venvScripts, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(venvScripts, "python.exe"), []byte(""), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "app.py"), []byte("print('ok')\n"), 0644))

	bashRes, err := ScanProjectForShell(dir, ShellGitBash)
	require.NoError(t, err)
	require.Len(t, bashRes.Commands, 1)
	assert.Equal(t, "./.venv/Scripts/python.exe app.py", bashRes.Commands[0].Command)
	assert.Equal(t, ShellDefault, bashRes.Commands[0].Shell)

	psRes, err := ScanProjectForShell(dir, ShellPowerShell)
	require.NoError(t, err)
	require.Len(t, psRes.Commands, 1)
	assert.Equal(t, `.\.venv\Scripts\python.exe app.py`, psRes.Commands[0].Command)
	assert.Equal(t, ShellDefault, psRes.Commands[0].Shell)
}
