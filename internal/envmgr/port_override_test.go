package envmgr

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestApplyTemporaryPortOverride_Frameworks(t *testing.T) {
	viteDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(viteDir, "package.json"), []byte(`{
		"scripts": { "dev": "vite", "custom": "node scripts/run.js" }
	}`), 0644))

	cases := []struct {
		name    string
		cmd     string
		cwd     string
		newPort int
		wantCmd string
	}{
		{
			name:    "maven spring boot",
			cmd:     `.\mvnw.cmd spring-boot:run`,
			newPort: 8085,
			wantCmd: `.\mvnw.cmd spring-boot:run -Dspring-boot.run.arguments=--server.port=8085`,
		},
		{
			name:    "java jar",
			cmd:     "java -jar target/app.jar",
			newPort: 8086,
			wantCmd: "java -jar target/app.jar --server.port=8086",
		},
		{
			name:    "explicit --port replaced",
			cmd:     "uvicorn main:app --reload --port 8000",
			newPort: 8001,
			wantCmd: "uvicorn main:app --reload --port 8001",
		},
		{
			name:    "uvicorn append port",
			cmd:     "uv run python -m uvicorn main:app --reload",
			newPort: 8002,
			wantCmd: "uv run python -m uvicorn main:app --reload --port 8002",
		},
		{
			name:    "django runserver append",
			cmd:     "python manage.py runserver",
			newPort: 8003,
			wantCmd: "python manage.py runserver 127.0.0.1:8003",
		},
		{
			name:    "django runserver replace",
			cmd:     "python manage.py runserver 0.0.0.0:8000",
			newPort: 8004,
			wantCmd: "python manage.py runserver 0.0.0.0:8004",
		},
		{
			name:    "pnpm vite dev",
			cmd:     "pnpm dev",
			cwd:     viteDir,
			newPort: 5175,
			wantCmd: "pnpm dev --port 5175",
		},
		{
			name:    "npm vite dev",
			cmd:     "npm run dev",
			cwd:     viteDir,
			newPort: 5176,
			wantCmd: "npm run dev -- --port 5176",
		},
		{
			name:    "non-vite custom script keeps command unchanged",
			cmd:     "pnpm custom",
			cwd:     viteDir,
			newPort: 4001,
			wantCmd: "pnpm custom",
		},
		{
			name:    "multiline preserves env lines and rewrites last line",
			cmd:     "$env:APP_ENV = \"dev\"\nuvicorn main:app --reload",
			newPort: 8010,
			wantCmd: "$env:APP_ENV = \"dev\"\nuvicorn main:app --reload --port 8010",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotCmd, extraEnv := ApplyTemporaryPortOverride(tc.cmd, ShellPowerShell, tc.cwd, tc.newPort)
			assert.Equal(t, tc.wantCmd, gotCmd)
			assert.Contains(t, extraEnv, "PORT="+formatInt(tc.newPort))
			assert.Contains(t, extraEnv, "SERVER_PORT="+formatInt(tc.newPort))
			assert.Contains(t, extraEnv, "VITE_PORT="+formatInt(tc.newPort))
		})
	}
}

func formatInt(n int) string {
	return string(rune('0'+n/1000)) + string(rune('0'+(n/100)%10)) + string(rune('0'+(n/10)%10)) + string(rune('0'+n%10))
}

func TestMergeExtraEnv_CaseInsensitiveReplace(t *testing.T) {
	base := []string{"PATH=C:\\Windows", "port=3000", "FOO=bar"}
	merged := mergeExtraEnv(base, []string{"PORT=8081", "SERVER_PORT=8081"})
	assert.Contains(t, merged, "PORT=8081")
	assert.NotContains(t, merged, "port=3000")
	assert.Contains(t, merged, "SERVER_PORT=8081")
	assert.Contains(t, merged, "FOO=bar")
}
