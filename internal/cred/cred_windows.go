//go:build windows

package cred

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modadvapi32 = windows.NewLazySystemDLL("advapi32.dll")

	procCredReadW   = modadvapi32.NewProc("CredReadW")
	procCredWriteW  = modadvapi32.NewProc("CredWriteW")
	procCredDeleteW = modadvapi32.NewProc("CredDeleteW")
	procCredFree    = modadvapi32.NewProc("CredFree")
)

const (
	CRED_TYPE_GENERIC          = 1
	CRED_PERSIST_LOCAL_MACHINE = 2
	ERROR_NOT_FOUND            = 1168
)

type filetime struct {
	dwLowDateTime  uint32
	dwHighDateTime uint32
}

type credentialW struct {
	flags              uint32
	credType           uint32
	targetName         *uint16
	comment            *uint16
	lastWritten        filetime
	credentialBlobSize uint32
	credentialBlob     *byte
	persist            uint32
	attributeCount     uint32
	attributes         uintptr
	targetAlias        *uint16
	userName           *uint16
}

// ReadRaw reads the raw bytes of a generic credential from Windows Credential Manager.
func ReadRaw(target string) ([]byte, error) {
	targetPtr, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return nil, fmt.Errorf("invalid target string: %w", err)
	}

	var pCred *credentialW
	r1, _, errSys := procCredReadW.Call(
		uintptr(unsafe.Pointer(targetPtr)),
		uintptr(CRED_TYPE_GENERIC),
		0,
		uintptr(unsafe.Pointer(&pCred)),
	)
	if r1 == 0 {
		errno, ok := errSys.(windows.Errno)
		if ok && errno == ERROR_NOT_FOUND {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("CredReadW failed for target '%s': %w", target, errSys)
	}
	defer procCredFree.Call(uintptr(unsafe.Pointer(pCred)))

	if pCred == nil || pCred.credentialBlobSize == 0 || pCred.credentialBlob == nil {
		return []byte{}, nil
	}

	blob := unsafe.Slice(pCred.credentialBlob, pCred.credentialBlobSize)
	result := make([]byte, len(blob))
	copy(result, blob)
	return result, nil
}

// WriteRaw writes raw bytes to Windows Credential Manager.
func WriteRaw(target string, userName string, data []byte) error {
	targetPtr, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return fmt.Errorf("invalid target string: %w", err)
	}

	var userPtr *uint16
	if userName != "" {
		userPtr, err = windows.UTF16PtrFromString(userName)
		if err != nil {
			return fmt.Errorf("invalid username string: %w", err)
		}
	}

	var blobPtr *byte
	if len(data) > 0 {
		blobPtr = &data[0]
	}

	cred := credentialW{
		flags:              0,
		credType:           CRED_TYPE_GENERIC,
		targetName:         targetPtr,
		comment:            nil,
		lastWritten:        filetime{},
		credentialBlobSize: uint32(len(data)),
		credentialBlob:     blobPtr,
		persist:            CRED_PERSIST_LOCAL_MACHINE,
		attributeCount:     0,
		attributes:         0,
		targetAlias:        nil,
		userName:           userPtr,
	}

	// Delete old entry first to ensure clean state
	_ = DeleteRaw(target)

	r1, _, errSys := procCredWriteW.Call(
		uintptr(unsafe.Pointer(&cred)),
		0,
	)
	if r1 == 0 {
		return fmt.Errorf("CredWriteW failed for target '%s': %w", target, errSys)
	}

	return nil
}

// DeleteRaw deletes a credential from Windows Credential Manager.
func DeleteRaw(target string) error {
	targetPtr, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return fmt.Errorf("invalid target string: %w", err)
	}

	r1, _, errSys := procCredDeleteW.Call(
		uintptr(unsafe.Pointer(targetPtr)),
		uintptr(CRED_TYPE_GENERIC),
		0,
	)
	if r1 == 0 {
		errno, ok := errSys.(windows.Errno)
		if ok && errno == ERROR_NOT_FOUND {
			return nil
		}
		return fmt.Errorf("CredDeleteW failed for target '%s': %w", target, errSys)
	}

	return nil
}

// DeleteCredential deletes a generic credential by target name.
func DeleteCredential(target string) error {
	return DeleteRaw(target)
}
