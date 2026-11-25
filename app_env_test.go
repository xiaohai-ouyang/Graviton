package main

import (
	"net"
	"os"
	"path/filepath"
	"testing"

	"graviton/internal/envmgr"
	"graviton/internal/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReorderProjects_CrossZoneAndPersistence(t *testing.T) {
	app := newTestApp(t)

	initial := []storage.ProjectRecord{
		{ID: "p1", Name: "Alpha", Path: `F:\alpha`, Pinned: false},
		{ID: "p2", Name: "Beta", Path: `F:\beta`, Pinned: false},
		{ID: "p3", Name: "Gamma", Path: `F:\gamma`, Pinned: false},
	}
	require.NoError(t, app.storageMgr.SaveProjects(initial))

	// Pin p3 and p1 in that order, leaving p2 unpinned.
	reordered, err := app.ReorderProjects([]string{"p3", "p1"}, []string{"p2"})
	require.NoError(t, err)
	require.Len(t, reordered, 3)

	assert.Equal(t, []string{"p3", "p1", "p2"}, []string{reordered[0].ID, reordered[1].ID, reordered[2].ID})
	assert.True(t, reordered[0].Pinned)
	assert.True(t, reordered[1].Pinned)
	assert.False(t, reordered[2].Pinned)

	// Reload from disk via ListProjects and confirm persistence.
	loaded, err := app.ListProjects()
	require.NoError(t, err)
	require.Len(t, loaded, 3)
	assert.Equal(t, []string{"p3", "p1", "p2"}, []string{loaded[0].ID, loaded[1].ID, loaded[2].ID})
	assert.True(t, loaded[0].Pinned)
	assert.True(t, loaded[1].Pinned)
	assert.False(t, loaded[2].Pinned)

	// Unpin p3 by moving it into unpinned list after p2.
	reordered2, err := app.ReorderProjects([]string{"p1"}, []string{"p2", "p3"})
	require.NoError(t, err)
	assert.Equal(t, []string{"p1", "p2", "p3"}, []string{reordered2[0].ID, reordered2[1].ID, reordered2[2].ID})
	assert.True(t, reordered2[0].Pinned)
	assert.False(t, reordered2[1].Pinned)
	assert.False(t, reordered2[2].Pinned)
}

func TestReorderProjects_PreservesUnmentionedProjects(t *testing.T) {
	app := newTestApp(t)

	initial := []storage.ProjectRecord{
		{ID: "p1", Name: "Alpha", Path: `F:\alpha`, Pinned: true},
		{ID: "p2", Name: "Beta", Path: `F:\beta`, Pinned: false},
		{ID: "p3", Name: "Gamma", Path: `F:\gamma`, Pinned: false},
	}
	require.NoError(t, app.storageMgr.SaveProjects(initial))

	// Omit p2 from both slices; it must still be preserved in the unpinned section.
	reordered, err := app.ReorderProjects([]string{"p3"}, []string{"p1"})
	require.NoError(t, err)
	require.Len(t, reordered, 3)
	assert.Equal(t, "p3", reordered[0].ID)
	assert.True(t, reordered[0].Pinned)
	assert.Equal(t, "p1", reordered[1].ID)
	assert.False(t, reordered[1].Pinned)
	assert.Equal(t, "p2", reordered[2].ID)
	assert.False(t, reordered[2].Pinned)
}

func TestImportProjectByPath_InsertsAfterPinnedProjects(t *testing.T) {
	app := newTestApp(t)

	initial := []storage.ProjectRecord{
		{ID: "p1", Name: "PinnedOne", Path: `F:\pinned1`, Pinned: true},
		{ID: "p2", Name: "NormalOne", Path: `F:\normal1`, Pinned: false},
	}
	require.NoError(t, app.storageMgr.SaveProjects(initial))

	projDir := filepath.Join(t.TempDir(), "NewProj")
	require.NoError(t, os.MkdirAll(projDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(projDir, "package.json"), []byte(`{"name":"new-proj","scripts":{"dev":"vite"}}`), 0644))

	imported, err := app.ImportProjectByPath(projDir)
	require.NoError(t, err)
	require.NotNil(t, imported)
	assert.False(t, imported.Pinned)

	loaded, err := app.ListProjects()
	require.NoError(t, err)
	require.Len(t, loaded, 3)
	// Pinned project stays at index 0, newly imported project goes to top of unpinned (index 1).
	assert.Equal(t, "p1", loaded[0].ID)
	assert.True(t, loaded[0].Pinned)
	assert.Equal(t, imported.ID, loaded[1].ID)
	assert.False(t, loaded[1].Pinned)
	assert.Equal(t, "p2", loaded[2].ID)
	assert.False(t, loaded[2].Pinned)
}

func TestSaveProjectCommand_PreservesQuotesMultilineAndShell(t *testing.T) {
	app := newTestApp(t)

	initial := []storage.ProjectRecord{
		{ID: "p1", Name: "Alpha", Path: `F:\alpha`, Commands: []storage.ProjectCommand{}},
	}
	require.NoError(t, app.storageMgr.SaveProjects(initial))

	rawCommand := "  \"C:\\Program Files\\Tool\\app.exe\" --flag \"val\"\r\n$env:FOO = \"bar\"\r\nWrite-Output $env:FOO  "
	wantCommand := "\"C:\\Program Files\\Tool\\app.exe\" --flag \"val\"\n$env:FOO = \"bar\"\nWrite-Output $env:FOO"

	savedProj, err := app.SaveProjectCommand("p1", storage.ProjectCommand{
		Name:     "Run PS",
		Command:  rawCommand,
		Cwd:      "scripts",
		Shell:    "PowerShell",
		Category: "dev",
		Pinned:   true,
	})
	require.NoError(t, err)
	require.Len(t, savedProj.Commands, 1)
	assert.Equal(t, wantCommand, savedProj.Commands[0].Command)
	assert.Equal(t, "powershell", savedProj.Commands[0].Shell)

	_, err = app.SaveProjectCommand("p1", storage.ProjectCommand{
		Name:     "Run Bash",
		Command:  "export FOO=bar\necho \"$FOO\"",
		Shell:    "gitbash",
		Category: "dev",
	})
	require.NoError(t, err)

	_, err = app.SaveProjectCommand("p1", storage.ProjectCommand{
		Name:     "Run CMD",
		Command:  `set "FOO=bar" & echo %FOO%`,
		Shell:    "cmd",
		Category: "dev",
	})
	require.NoError(t, err)

	_, err = app.SaveProjectCommand("p1", storage.ProjectCommand{
		Name:     "Run Default",
		Command:  "go test ./...",
		Shell:    "",
		Category: "test",
	})
	require.NoError(t, err)

	loaded, err := app.ListProjects()
	require.NoError(t, err)
	require.Len(t, loaded, 1)
	require.Len(t, loaded[0].Commands, 4)

	byName := make(map[string]storage.ProjectCommand, len(loaded[0].Commands))
	for _, c := range loaded[0].Commands {
		byName[c.Name] = c
	}
	assert.Equal(t, wantCommand, byName["Run PS"].Command)
	assert.Equal(t, "powershell", byName["Run PS"].Shell)
	assert.Equal(t, "gitbash", byName["Run Bash"].Shell)
	assert.Equal(t, "cmd", byName["Run CMD"].Shell)
	assert.Equal(t, "", byName["Run Default"].Shell)
}

func TestShellConfigPersistence(t *testing.T) {
	app := newTestApp(t)

	initialEnv := app.GetShellEnvironment()
	assert.Equal(t, envmgr.ShellPowerShell, initialEnv.Config.DefaultShell)
	assert.Empty(t, initialEnv.Config.GitBashPath)
	require.Len(t, initialEnv.Shells, 3)
	assert.Equal(t, []string{envmgr.ShellPowerShell, envmgr.ShellGitBash, envmgr.ShellCMD}, []string{
		initialEnv.Shells[0].Shell,
		initialEnv.Shells[1].Shell,
		initialEnv.Shells[2].Shell,
	})

	dummyBash := filepath.Join(t.TempDir(), "bash.exe")
	require.NoError(t, os.WriteFile(dummyBash, []byte("stub"), 0644))

	updatedEnv, err := app.SaveShellConfig(envmgr.ShellConfig{
		DefaultShell: "gitbash",
		GitBashPath:  dummyBash,
	})
	require.NoError(t, err)
	assert.Equal(t, envmgr.ShellGitBash, updatedEnv.Config.DefaultShell)
	assert.Equal(t, dummyBash, updatedEnv.Config.GitBashPath)
	assert.Equal(t, envmgr.ShellGitBash, updatedEnv.Shells[1].Shell)
	assert.True(t, updatedEnv.Shells[1].Available)
	assert.Equal(t, dummyBash, updatedEnv.Shells[1].Path)

	sf, _, err := app.storageMgr.LoadSettings()
	require.NoError(t, err)
	assert.Equal(t, "gitbash", sf.DefaultShell)
	assert.Equal(t, dummyBash, sf.GitBashPath)

	resetEnv, err := app.ResetGitBashPath()
	require.NoError(t, err)
	assert.Equal(t, envmgr.ShellGitBash, resetEnv.Config.DefaultShell)
	assert.Empty(t, resetEnv.Config.GitBashPath)

	sfAfterReset, _, err := app.storageMgr.LoadSettings()
	require.NoError(t, err)
	assert.Empty(t, sfAfterReset.GitBashPath)
}

func TestPortConflictAndOverview_FocusedOnImportedProjects(t *testing.T) {
	app := newTestApp(t)

	// Open a real local TCP listener to simulate an external process occupying a port
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()
	occupiedPort := ln.Addr().(*net.TCPAddr).Port

	initial := []storage.ProjectRecord{
		{
			ID:   "p-java",
			Name: "JavaBackend",
			Path: `F:\java-backend`,
			Commands: []storage.ProjectCommand{
				{ID: "c-java", Name: "启动 Spring Boot", Command: "mvn spring-boot:run", Category: "dev", Pinned: true, Source: "rule", ExpectedPort: occupiedPort},
			},
		},
		{
			ID:   "p-py",
			Name: "PyBackend",
			Path: `F:\py-backend`,
			Commands: []storage.ProjectCommand{
				{ID: "c-py", Name: "启动 FastAPI", Command: "uvicorn main:app", Category: "dev", Pinned: true, Source: "rule", ExpectedPort: occupiedPort},
			},
		},
	}
	require.NoError(t, app.storageMgr.SaveProjects(initial))

	// Invalid port validation
	_, err = app.SaveProjectCommand("p-java", storage.ProjectCommand{
		Name:         "Bad Port",
		Command:      "echo hi",
		ExpectedPort: 70000,
	})
	assert.Error(t, err)

	// Conflict check detects the live external listener and suggests a free port
	check, err := app.CheckCommandPortConflict("p-java", "c-java")
	require.NoError(t, err)
	assert.True(t, check.HasConflict)
	assert.Equal(t, occupiedPort, check.Port)
	assert.NotEqual(t, occupiedPort, check.SuggestedPort)
	require.NotNil(t, check.Occupant)
	assert.False(t, check.Occupant.IsManaged)
	assert.Equal(t, os.Getpid(), check.Occupant.PID)

	// Overview only includes imported projects' entries, marking both static clash & external clash
	overview, err := app.GetProjectPortOverview()
	require.NoError(t, err)
	require.Len(t, overview.Entries, 2)
	assert.Equal(t, 1, overview.ConflictCount)
	for _, entry := range overview.Entries {
		assert.Equal(t, occupiedPort, entry.Port)
		assert.True(t, entry.StaticClash)
		require.NotNil(t, entry.ExternalClash)
		assert.Equal(t, os.Getpid(), entry.ExternalClash.PID)
	}
}
