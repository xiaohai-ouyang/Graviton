package updater

import (
	"errors"
	"net/url"
	"strings"
)

// NormalizeMirrorURL validates an optional GitHub download mirror prefix.
// Empty input means direct connection; only http/https URLs with a host are accepted.
func NormalizeMirrorURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", errors.New("镜像前缀格式无效，请输入完整的 http(s) 地址")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("镜像前缀仅支持 http:// 或 https:// 协议")
	}
	if parsed.Host == "" {
		return "", errors.New("镜像前缀缺少有效的主机地址")
	}
	return strings.TrimRight(trimmed, "/") + "/", nil
}

// ApplyMirror prefixes a GitHub download URL with the configured mirror.
// Non-GitHub URLs and empty prefixes pass through unchanged.
func ApplyMirror(downloadURL, mirrorPrefix string) string {
	if mirrorPrefix == "" || !strings.HasPrefix(downloadURL, "https://github.com/") {
		return downloadURL
	}
	return mirrorPrefix + downloadURL
}