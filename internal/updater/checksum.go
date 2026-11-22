package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
)

var sha256LinePattern = regexp.MustCompile(`^([0-9a-fA-F]{64})\s+(.+)$`)

// ParseSHA256Sums parses "<64-hex>  <filename>" lines (LF or CRLF) into a filename → digest map.
func ParseSHA256Sums(content string) map[string]string {
	result := make(map[string]string)
	for _, line := range strings.Split(content, "\n") {
		matches := sha256LinePattern.FindStringSubmatch(strings.TrimSpace(line))
		if matches == nil {
			continue
		}
		result[strings.TrimSpace(matches[2])] = strings.ToLower(matches[1])
	}
	return result
}

// VerifyFileSHA256 streams the file through SHA-256 and compares against the expected hex digest.
func VerifyFileSHA256(filePath, expectedHex string) error {
	expected := strings.ToLower(strings.TrimSpace(expectedHex))
	if len(expected) != 64 {
		return fmt.Errorf("SHA256SUMS.txt 中缺少该文件的有效校验值，已拒绝安装")
	}

	f, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("打开待校验文件失败: %w", err)
	}
	defer f.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, f); err != nil {
		return fmt.Errorf("计算文件 SHA-256 失败: %w", err)
	}
	actual := hex.EncodeToString(hasher.Sum(nil))
	if actual != expected {
		return fmt.Errorf("SHA-256 校验不匹配，安装包可能被篡改或下载损坏，已拒绝安装")
	}
	return nil
}