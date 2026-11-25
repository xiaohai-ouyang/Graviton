package envmgr

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	reReplaceServerPortArg = regexp.MustCompile(`(?i)(--server\.port(?:=|\s+))\d{2,5}\b`)
	reReplaceLongPortArg   = regexp.MustCompile(`(?i)(--port(?:=|\s+))\d{2,5}\b`)
	reReplaceShortPortArg  = regexp.MustCompile(`((?:^|\s)-p\s+)\d{2,5}\b`)
	reReplaceDjangoPort    = regexp.MustCompile(`(?i)(manage\.py\s+runserver)(?:\s+([\w.\[\]:]+:)?\d{2,5})?\b`)
	reMvnSpringBootArgs    = regexp.MustCompile(`(?i)(-Dspring-boot\.run\.arguments=)("[^"]*"|'[^']*'|\S+)`)
	rePackageScriptCall    = regexp.MustCompile(`(?i)^(npm\s+run|pnpm|yarn|bun\s+run)\s+([a-z0-9:_-]+)\s*$`)
)

// ApplyTemporaryPortOverride produces temporary command-line rewrites and process-scoped env vars
// for starting a command on an alternate port without mutating the saved command or project files.
func ApplyTemporaryPortOverride(commandLine, resolvedShell, cwdDir string, newPort int) (rewrittenCmd string, extraEnv []string) {
	normalized := NormalizeCommandText(commandLine)
	if !isValidPort(newPort) || normalized == "" {
		return normalized, nil
	}

	portStr := fmt.Sprintf("%d", newPort)
	extraEnv = []string{
		"PORT=" + portStr,
		"SERVER_PORT=" + portStr,
		"VITE_PORT=" + portStr,
		"FLASK_RUN_PORT=" + portStr,
		"STREAMLIT_SERVER_PORT=" + portStr,
		"GRADIO_SERVER_PORT=" + portStr,
	}

	lines := strings.Split(normalized, "\n")
	targetIdx := -1
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.TrimSpace(lines[i]) != "" && !strings.HasPrefix(strings.TrimSpace(lines[i]), "#") {
			targetIdx = i
			break
		}
	}
	if targetIdx < 0 {
		return normalized, extraEnv
	}

	lines[targetIdx] = rewriteSingleLinePort(lines[targetIdx], cwdDir, newPort)
	return strings.Join(lines, "\n"), extraEnv
}

func rewriteSingleLinePort(line, cwdDir string, newPort int) string {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return line
	}
	portStr := fmt.Sprintf("%d", newPort)
	lower := strings.ToLower(trimmed)

	// 1. Replace existing explicit flags in place
	if reReplaceServerPortArg.MatchString(trimmed) {
		return reReplaceServerPortArg.ReplaceAllString(trimmed, "${1}"+portStr)
	}
	if reReplaceLongPortArg.MatchString(trimmed) {
		return reReplaceLongPortArg.ReplaceAllString(trimmed, "${1}"+portStr)
	}
	if !strings.Contains(lower, "docker") && !strings.Contains(lower, "mkdir") && reReplaceShortPortArg.MatchString(trimmed) {
		return reReplaceShortPortArg.ReplaceAllString(trimmed, "${1}"+portStr)
	}

	// Avoid appending CLI arguments blindly to compound shell chains
	if strings.ContainsAny(trimmed, "|&;") {
		return trimmed
	}

	// 2. Django manage.py runserver
	if reReplaceDjangoPort.MatchString(trimmed) {
		return reReplaceDjangoPort.ReplaceAllStringFunc(trimmed, func(match string) string {
			sub := reReplaceDjangoPort.FindStringSubmatch(match)
			if len(sub) >= 3 && sub[2] != "" {
				return sub[1] + " " + sub[2] + portStr
			}
			return sub[1] + " 127.0.0.1:" + portStr
		})
	}

	// 3. Spring Boot via Maven
	if strings.Contains(lower, "spring-boot:run") {
		if reMvnSpringBootArgs.MatchString(trimmed) {
			return reMvnSpringBootArgs.ReplaceAllStringFunc(trimmed, func(m string) string {
				sub := reMvnSpringBootArgs.FindStringSubmatch(m)
				if len(sub) != 3 {
					return m
				}
				val := strings.Trim(sub[2], `"'`)
				return fmt.Sprintf(`%s"%s --server.port=%s"`, sub[1], val, portStr)
			})
		}
		return trimmed + " -Dspring-boot.run.arguments=--server.port=" + portStr
	}

	// 4. Java -jar
	if strings.Contains(lower, "java") && strings.Contains(lower, "-jar") {
		return trimmed + " --server.port=" + portStr
	}

	// 5. Python web runners
	if strings.Contains(lower, "uvicorn") {
		return trimmed + " --port " + portStr
	}
	if strings.Contains(lower, "streamlit") && strings.Contains(lower, "run") {
		return trimmed + " --server.port " + portStr
	}
	if strings.Contains(lower, "flask") && strings.Contains(lower, "run") {
		return trimmed + " --port " + portStr
	}

	// 6. Direct frontend dev servers
	if strings.HasPrefix(lower, "vite") || strings.Contains(lower, " vite") ||
		strings.HasPrefix(lower, "next ") || strings.HasPrefix(lower, "nuxt ") {
		return trimmed + " --port " + portStr
	}

	// 7. Package manager dev scripts (only append --port when package.json confirms Vite/Next/Nuxt)
	if m := rePackageScriptCall.FindStringSubmatch(trimmed); len(m) == 3 && cwdDir != "" {
		pmPrefix := strings.ToLower(strings.TrimSpace(m[1]))
		scriptName := m[2]
		if pkg, ok := readPackageJSON(filepath.Join(cwdDir, "package.json")); ok {
			rawScript := strings.ToLower(pkg.Scripts[scriptName])
			if strings.Contains(rawScript, "vite") || strings.Contains(rawScript, "next ") || strings.Contains(rawScript, "nuxt") {
				if strings.HasPrefix(pmPrefix, "npm") || strings.HasPrefix(pmPrefix, "bun") {
					return trimmed + " -- --port " + portStr
				}
				return trimmed + " --port " + portStr
			}
		}
	}

	// Gradle bootRun & other frameworks pick up SERVER_PORT / PORT from extraEnv automatically
	return trimmed
}

// mergeExtraEnv merges overrides into a base KEY=VALUE env slice, replacing existing keys case-insensitively on Windows.
func mergeExtraEnv(base, overrides []string) []string {
	if len(overrides) == 0 {
		return base
	}
	out := make([]string, len(base), len(base)+len(overrides))
	copy(out, base)
	for _, kv := range overrides {
		eq := strings.IndexByte(kv, '=')
		if eq <= 0 {
			continue
		}
		prefix := kv[:eq+1]
		replaced := false
		for i, existing := range out {
			if len(existing) >= len(prefix) && strings.EqualFold(existing[:len(prefix)], prefix) {
				out[i] = kv
				replaced = true
				break
			}
		}
		if !replaced {
			out = append(out, kv)
		}
	}
	return out
}
