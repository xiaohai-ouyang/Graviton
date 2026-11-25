package envmgr

import (
	"os"
	"path/filepath"
	"testing"

	"graviton/internal/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMergeAICommands_TranslatesByIDAndNormalizesShellOverrides(t *testing.T) {
	existing := []storage.ProjectCommand{
		{
			ID:       "manual-1",
			Name:     "手动指令",
			Command:  "echo keep me",
			Cwd:      "",
			Shell:    ShellCMD,
			Category: "other",
			Pinned:   true,
			Source:   "manual",
		},
		{
			ID:       "rule-1",
			Name:     "启动 Python 服务",
			Command:  `.\.venv\Scripts\python.exe app.py`,
			Cwd:      "backend",
			Shell:    "",
			Category: "dev",
			Pinned:   true,
			Source:   "rule",
		},
		{
			ID:       "rule-2",
			Name:     "运行测试",
			Command:  "go test ./...",
			Cwd:      "",
			Shell:    "",
			Category: "test",
			Pinned:   false,
			Source:   "rule",
		},
	}

	suggested := []aiSuggestedCommand{
		{
			ID:       "rule-1",
			Name:     "启动后端",
			Command:  "export APP_ENV=\"dev\"\r\n./.venv/Scripts/python.exe app.py",
			Cwd:      "backend",
			Shell:    "gitbash", // Matches targetShell -> should collapse to ""
			Category: "dev",
			Pinned:   true,
		},
		{
			Name:     "PowerShell 检查脚本",
			Command:  `& ".\scripts\check.ps1"`,
			Cwd:      "",
			Shell:    "powershell", // Explicit cross-shell override -> must be kept
			Category: "lint",
			Pinned:   false,
		},
		{
			ID:       "manual-1", // Must NOT overwrite manual command
			Name:     "Attempted Overwrite",
			Command:  "echo overwritten",
			Cwd:      "",
			Shell:    "gitbash",
			Category: "other",
			Pinned:   false,
		},
	}

	merged := mergeAICommands(existing, suggested, ShellGitBash)
	require.Len(t, merged, 4)

	// 1. Manual command untouched at index 0
	assert.Equal(t, "manual-1", merged[0].ID)
	assert.Equal(t, "手动指令", merged[0].Name)
	assert.Equal(t, "echo keep me", merged[0].Command)
	assert.Equal(t, ShellCMD, merged[0].Shell)
	assert.Equal(t, "manual", merged[0].Source)

	// 2. Existing rule-1 updated in-place by ID, with LF line endings and collapsed shell ""
	assert.Equal(t, "rule-1", merged[1].ID)
	assert.Equal(t, "启动后端", merged[1].Name)
	assert.Equal(t, "export APP_ENV=\"dev\"\n./.venv/Scripts/python.exe app.py", merged[1].Command)
	assert.Equal(t, ShellDefault, merged[1].Shell)
	assert.Equal(t, "ai", merged[1].Source)

	// 3. New cross-shell command retains explicit override
	assert.Equal(t, "PowerShell 检查脚本", merged[2].Name)
	assert.Equal(t, ShellPowerShell, merged[2].Shell)
	assert.Equal(t, "ai", merged[2].Source)

	// 4. Omitted rule-2 is preserved unpinned (suggestion targeting manual-1 was skipped)
	assert.Equal(t, "rule-2", merged[3].ID)
	assert.False(t, merged[3].Pinned)
}

func TestMergeAICommands_ExpectedPortAndSecretFiltering(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".env"), []byte(
		"PORT=8088\nAPI_KEY=super-secret-value\nDB_PASSWORD=topsecret\nSERVER_HOST=127.0.0.1\n",
	), 0644))

	ctxText := buildProjectContextForAI(storage.ProjectRecord{
		Name: "Demo",
		Path: dir,
	}, ShellPowerShell)
	assert.Contains(t, ctxText, "PORT=8088")
	assert.NotContains(t, ctxText, "super-secret-value")
	assert.NotContains(t, ctxText, "topsecret")

	existing := []storage.ProjectCommand{
		{ID: "c1", Name: "启动后端", Command: "python app.py", Category: "dev", Source: "rule", ExpectedPort: 5000},
	}
	suggested := []aiSuggestedCommand{
		{ID: "c1", Name: "启动 Flask", Command: "python app.py", Category: "dev", Pinned: true, ExpectedPort: 8088},
	}
	merged := mergeAICommands(existing, suggested, ShellPowerShell)
	require.Len(t, merged, 1)
	assert.Equal(t, 8088, merged[0].ExpectedPort)
}
