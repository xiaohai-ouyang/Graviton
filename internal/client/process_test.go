//go:build windows

package client

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseCommandLineArgs(t *testing.T) {
	// Standard quoted command line
	cmdLine := `"C:\Program Files\Antigravity\Antigravity.exe" --user-data-dir="C:\data" --flag1 --standalone --override_ide_name="test"`
	args := ParseCommandLineArgs(cmdLine)
	assert.Contains(t, args, `--user-data-dir=C:\data`)
	assert.Contains(t, args, "--flag1")
	// Internal engine flags should be filtered out
	for _, a := range args {
		assert.NotContains(t, a, "--standalone")
		assert.NotContains(t, a, "--override_ide_name")
	}

	// Empty
	assert.Nil(t, ParseCommandLineArgs(""))
}

func TestClientSwitcher_NilPayloadValidation(t *testing.T) {
	switcher := NewClientSwitcher()
	require.NotNil(t, switcher)

	// Nil payload should fail with clear error
	_, err := switcher.SwitchAccount(nil, "")
	assert.Error(t, err)
}

func TestDetectClientPath_NonExistentOverride(t *testing.T) {
	_, err := DetectClientPath(`C:\DefinitelyNonExistentDirectory_12345\Antigravity.exe`)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "指定的客户端路径不存在")
}
