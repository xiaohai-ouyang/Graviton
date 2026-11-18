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
