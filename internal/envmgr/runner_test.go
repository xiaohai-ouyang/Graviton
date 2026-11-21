package envmgr

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/text/encoding/simplifiedchinese"
)

func TestNormalizeLogLine_GBKToUTF8(t *testing.T) {
	want := "2026-11-20 21:15:12,707 INFO 后端启动 v2.8，日志目录 F:\\CodeProject\\DobotWeb\\logs"
	gbkBytes, err := simplifiedchinese.GB18030.NewEncoder().Bytes([]byte(want))
	require.NoError(t, err)

	got := normalizeLogLine(gbkBytes)
	assert.Equal(t, want, got)
}

func TestNormalizeLogLine_UTF8AndANSI(t *testing.T) {
	raw := "\x1b[2m11:21:17\x1b[22m \x1b[36m\x1b[1m[vite]\x1b[22m\x1b[39m \x1b[32mhmr update\x1b[39m 中文正常"
	got := normalizeLogLine([]byte(raw))
	assert.Equal(t, "11:21:17 [vite] hmr update 中文正常", got)
}

func TestWithUTF8ProcessEnv(t *testing.T) {
	env := withUTF8ProcessEnv([]string{"PATH=C:\\Windows", "pythonioencoding=gbk"})
	assert.Contains(t, env, "PYTHONUTF8=1")
	assert.Contains(t, env, "PYTHONUNBUFFERED=1")
	assert.Contains(t, env, "pythonioencoding=gbk")
	assert.NotContains(t, env, "PYTHONIOENCODING=utf-8")
}
