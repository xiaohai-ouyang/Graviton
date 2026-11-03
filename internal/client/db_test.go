package client

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"
)

func createTestItemTable(t *testing.T, dbPath string) {
	db, err := sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	defer db.Close()

	_, err = db.Exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)")
	require.NoError(t, err)
}

func TestLegacyDB_SchemaValidation(t *testing.T) {
	tempDir := t.TempDir()
	dbSync := &LegacyDBSync{}

	// Non-existent file
	err := dbSync.ValidateDBSchema(filepath.Join(tempDir, "nonexistent.db"))
	assert.Error(t, err)

	// File exists but no ItemTable
	emptyDB := filepath.Join(tempDir, "empty.db")
	db, err := sql.Open("sqlite", emptyDB)
	require.NoError(t, err)
	_, err = db.Exec("CREATE TABLE OtherTable (id INT)")
	require.NoError(t, err)
	db.Close()

	err = dbSync.ValidateDBSchema(emptyDB)
	assert.ErrorContains(t, err, "ItemTable does not exist")

	// Valid schema
	validDB := filepath.Join(tempDir, "valid.vscdb")
	createTestItemTable(t, validDB)
	err = dbSync.ValidateDBSchema(validDB)
	assert.NoError(t, err)
}

func TestLegacyDB_InjectAndRead(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "state.vscdb")
	createTestItemTable(t, dbPath)

	dbSync := &LegacyDBSync{}

	at := "ya29.test-access-token-123"
	rt := "1//test-refresh-token-456"
	expiry := int64(1800000000)
	email := "bob@example.com"

	err := dbSync.InjectLegacyToken(dbPath, at, rt, expiry, email, false)
	require.NoError(t, err)

	// Read back
	readAt, readRt, readExp, readEmail, err := dbSync.ReadLegacyToken(dbPath)
	require.NoError(t, err)
	assert.Equal(t, at, readAt)
	assert.Equal(t, rt, readRt)
	assert.Equal(t, expiry, readExp)
	assert.Equal(t, email, readEmail)

	// Check onboarding flag was inserted
	db, err := sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	defer db.Close()
	var ob string
	err = db.QueryRow("SELECT value FROM ItemTable WHERE key = 'antigravityOnboarding'").Scan(&ob)
	require.NoError(t, err)
	assert.Equal(t, "true", ob)
}

func TestLegacyDB_BackupAndRestore(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "state.vscdb")
	createTestItemTable(t, dbPath)

	dbSync := &LegacyDBSync{}

	// Insert test row
	db, err := sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	_, err = db.Exec("INSERT INTO ItemTable (key, value) VALUES ('test', 'val1')")
	require.NoError(t, err)
	db.Close()

	// Backup
	backupPath, err := dbSync.BackupDB(dbPath)
	require.NoError(t, err)
	assert.FileExists(t, backupPath)

	// Modify original
	db, err = sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	_, err = db.Exec("UPDATE ItemTable SET value = 'val2' WHERE key = 'test'")
	require.NoError(t, err)
	db.Close()

	// Restore
	err = dbSync.RestoreBackup(dbPath, backupPath)
	require.NoError(t, err)

	// Verify restored value is val1
	db, err = sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	defer db.Close()
	var val string
	err = db.QueryRow("SELECT value FROM ItemTable WHERE key = 'test'").Scan(&val)
	require.NoError(t, err)
	assert.Equal(t, "val1", val)
}
