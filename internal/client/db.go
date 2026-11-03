package client

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// LegacyDBSync handles reading and writing legacy Antigravity state.vscdb SQLite files.
type LegacyDBSync struct{}

// ValidateDBSchema checks if ItemTable exists with required columns.
func (s *LegacyDBSync) ValidateDBSchema(dbPath string) error {
	if _, err := os.Stat(dbPath); err != nil {
		return fmt.Errorf("database file does not exist: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}
	defer db.Close()

	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ItemTable'").Scan(&count)
	if err != nil || count == 0 {
		return errors.New("ItemTable does not exist in SQLite database")
	}

	return nil
}

// BackupDB copies dbPath to dbPath.backup.
func (s *LegacyDBSync) BackupDB(dbPath string) (string, error) {
	backupPath := dbPath + ".backup"
	src, err := os.Open(dbPath)
	if err != nil {
		return "", fmt.Errorf("failed to open source DB for backup: %w", err)
	}
	defer src.Close()

	dst, err := os.Create(backupPath)
	if err != nil {
		return "", fmt.Errorf("failed to create backup DB file: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return "", fmt.Errorf("failed to copy DB to backup: %w", err)
	}

	return backupPath, nil
}

// RestoreBackup restores dbPath from backupPath.
func (s *LegacyDBSync) RestoreBackup(dbPath, backupPath string) error {
	src, err := os.Open(backupPath)
	if err != nil {
		return fmt.Errorf("failed to open backup file for restore: %w", err)
	}
	defer src.Close()

	dst, err := os.OpenFile(dbPath, os.O_WRONLY|os.O_TRUNC|os.O_CREATE, 0644)
	if err != nil {
		return fmt.Errorf("failed to open DB file for restore: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("failed to restore DB file: %w", err)
	}
	return nil
}

// ReadLegacyToken reads the OAuth token and email from state.vscdb.
func (s *LegacyDBSync) ReadLegacyToken(dbPath string) (accessToken, refreshToken string, expiry int64, email string, err error) {
	if err := s.ValidateDBSchema(dbPath); err != nil {
		return "", "", 0, "", err
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return "", "", 0, "", err
	}
	defer db.Close()

	var valB64 string
	err = db.QueryRow("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken'").Scan(&valB64)
	if err != nil {
		return "", "", 0, "", fmt.Errorf("oauthToken key not found: %w", err)
	}

	topicBytes, err := base64.StdEncoding.DecodeString(valB64)
	if err != nil {
		return "", "", 0, "", fmt.Errorf("failed to decode base64 oauthToken: %w", err)
	}

	// Find the oauthTokenInfoSentinelKey row in topic data
	dataEntries, err := findAllFields(topicBytes, 1)
	if err != nil || len(dataEntries) == 0 {
		return "", "", 0, "", errors.New("no topic entries found")
	}

	for _, entry := range dataEntries {
		keyBytes, ok, _ := findField(entry, 1)
		if !ok || string(keyBytes) != "oauthTokenInfoSentinelKey" {
			continue
		}
		rowBytes, ok, _ := findField(entry, 2)
		if !ok {
			continue
		}
		payloadB64Bytes, ok, _ := findField(rowBytes, 1)
		if !ok {
			continue
		}
		payloadBytes, err := base64.StdEncoding.DecodeString(string(payloadB64Bytes))
		if err != nil {
			payloadBytes = payloadB64Bytes
		}
		accessToken, refreshToken, expiry, _, err = DecodeOAuthInfo(payloadBytes)
		if err == nil && refreshToken != "" {
			break
		}
	}

	// Try reading email from userStatus
	var userStatusB64 string
	if err := db.QueryRow("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.userStatus'").Scan(&userStatusB64); err == nil {
		if rawTopic, err := base64.StdEncoding.DecodeString(userStatusB64); err == nil {
			if entries, err := findAllFields(rawTopic, 1); err == nil {
				for _, entry := range entries {
					if rowBytes, ok, _ := findField(entry, 2); ok {
						if pB64, ok, _ := findField(rowBytes, 1); ok {
							if decoded, err := base64.StdEncoding.DecodeString(string(pB64)); err == nil {
								// Field 3 or 7 has email
								if emailBytes, ok, _ := findField(decoded, 3); ok && len(emailBytes) > 0 {
									email = string(emailBytes)
									break
								}
							}
						}
					}
				}
			}
		}
	}

	return accessToken, refreshToken, expiry, email, nil
}

// InjectLegacyToken writes the tokens and email into state.vscdb inside a transaction with automatic backup & restore.
func (s *LegacyDBSync) InjectLegacyToken(dbPath, accessToken, refreshToken string, expiry int64, email string, isGCPTos bool) error {
	if err := s.ValidateDBSchema(dbPath); err != nil {
		return err
	}

	backupPath, err := s.BackupDB(dbPath)
	if err != nil {
		return fmt.Errorf("failed to backup database: %w", err)
	}
	defer func() {
		// Clean up backup on success, or keep it if something went wrong
	}()

	err = s.injectInTransaction(dbPath, accessToken, refreshToken, expiry, email, isGCPTos)
	if err != nil {
		restoreErr := s.RestoreBackup(dbPath, backupPath)
		if restoreErr != nil {
			return fmt.Errorf("injection failed (%v) AND database restore from backup failed: %w", err, restoreErr)
		}
		return fmt.Errorf("injection failed (%w), database restored from backup", err)
	}

	_ = os.Remove(backupPath)
	return nil
}

func (s *LegacyDBSync) injectInTransaction(dbPath, accessToken, refreshToken string, expiry int64, email string, isGCPTos bool) error {
	db, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(2000)")
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}
	defer db.Close()

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	// 1. Read existing oauthToken
	var currentVal string
	_ = tx.QueryRow("SELECT value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken'").Scan(&currentVal)

	var currentTopic []byte
	if currentVal != "" {
		currentTopic, _ = base64.StdEncoding.DecodeString(currentVal)
	}

	// 2. Remove old entry
	cleanedTopic, _ := RemoveUnifiedTopicEntry(currentTopic, "oauthTokenInfoSentinelKey")

	// 3. Create new oauth info & entry
	oauthInfo := CreateOAuthInfo(accessToken, refreshToken, expiry, isGCPTos, "", email)
	entry := CreateUnifiedTopicEntry("oauthTokenInfoSentinelKey", oauthInfo)
	newTopic := append(cleanedTopic, entry...)
	newTopicB64 := base64.StdEncoding.EncodeToString(newTopic)

	// 4. Update oauthToken
	_, err = tx.Exec("INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('antigravityUnifiedStateSync.oauthToken', ?)", newTopicB64)
	if err != nil {
		return fmt.Errorf("failed to write oauthToken: %w", err)
	}

	// 5. Update userStatus
	userPayload := CreateMinimalUserStatusPayload(email)
	userStatusEntryB64 := CreateUnifiedStateEntry("userStatusSentinelKey", userPayload)
	_, err = tx.Exec("INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('antigravityUnifiedStateSync.userStatus', ?)", userStatusEntryB64)
	if err != nil {
		return fmt.Errorf("failed to write userStatus: %w", err)
	}

	// 6. Set onboarding flag
	_, err = tx.Exec("INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('antigravityOnboarding', 'true')")
	if err != nil {
		return fmt.Errorf("failed to write onboarding flag: %w", err)
	}

	// 7. Clear stale session state
	_, _ = tx.Exec("DELETE FROM ItemTable WHERE key = 'jetskiStateSync.agentManagerInitState'")

	return tx.Commit()
}

// FindCandidateLegacyDBPaths returns possible paths for state.vscdb on the current machine.
func FindCandidateLegacyDBPaths(appData string, clientExePath string) []string {
	var paths []string

	if appData != "" {
		paths = append(paths, filepath.Join(appData, "Antigravity", "User", "globalStorage", "state.vscdb"))
	}

	if clientExePath != "" {
		parent := filepath.Dir(clientExePath)
		paths = append(paths, filepath.Join(parent, "data", "user-data", "User", "globalStorage", "state.vscdb"))
	}

	return paths
}
