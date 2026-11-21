package main

import (
	"os"
	"path/filepath"
	"testing"

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
