//go:build windows

package storage

import (
	"fmt"

	"golang.org/x/sys/windows"
)

// ReplaceFile atomically replaces targetPath with sourcePath on Windows.
func ReplaceFile(sourcePath, targetPath string) error {
	fromPtr, err := windows.UTF16PtrFromString(sourcePath)
	if err != nil {
		return fmt.Errorf("invalid source path: %w", err)
	}

	toPtr, err := windows.UTF16PtrFromString(targetPath)
	if err != nil {
		return fmt.Errorf("invalid target path: %w", err)
	}

	flags := uint32(windows.MOVEFILE_REPLACE_EXISTING | windows.MOVEFILE_WRITE_THROUGH)
	if err := windows.MoveFileEx(fromPtr, toPtr, flags); err != nil {
		return fmt.Errorf("MoveFileEx failed: %w", err)
	}

	return nil
}
