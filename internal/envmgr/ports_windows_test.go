//go:build windows

package envmgr

import (
	"net"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListListeningTCPSockets_DetectsLiveListenerAndSkipsInFindAvailablePort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()

	port := ln.Addr().(*net.TCPAddr).Port
	myPID := os.Getpid()

	listeners, err := ListListeningTCPSockets()
	require.NoError(t, err)

	var found bool
	for _, l := range listeners {
		if l.Port == port && l.PID == myPID {
			found = true
			assert.NotEmpty(t, l.ProcessName)
			break
		}
	}
	assert.True(t, found, "expected ListListeningTCPSockets to report live listener on port %d (PID %d)", port, myPID)

	// FindAvailablePort starting at port-1 should skip the occupied port
	suggested := FindAvailablePort(port - 1)
	assert.NotEqual(t, port, suggested)
	assert.True(t, isValidPort(suggested))

	require.NoError(t, ln.Close())
}

func TestExtractLogPortHints(t *testing.T) {
	h1 := extractLogPortHints("  ➜  Local:   http://localhost:5174/")
	assert.Equal(t, "http", h1[5174])

	h2 := extractLogPortHints("INFO 1234 --- [main] o.s.b.w.embedded.tomcat.TomcatWebServer : Tomcat started on port(s): 8080 (https)")
	assert.Equal(t, "https", h2[8080])

	h3 := extractLogPortHints("INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)")
	assert.Equal(t, "http", h3[8000])
}

func TestValidateLocalURL(t *testing.T) {
	okURL, err := ValidateLocalURL("http://localhost:5173/app")
	require.NoError(t, err)
	assert.Equal(t, "http://localhost:5173/app", okURL)

	_, err = ValidateLocalURL("https://127.0.0.1:8443")
	require.NoError(t, err)

	_, err = ValidateLocalURL("https://example.com:8080")
	assert.Error(t, err)

	_, err = ValidateLocalURL("file:///C:/Windows/System32/calc.exe")
	assert.Error(t, err)
}
