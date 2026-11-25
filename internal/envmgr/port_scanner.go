package envmgr

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

var (
	reCLIServerPort    = regexp.MustCompile(`(?i)--server\.port(?:=|\s+)(\d{2,5})\b`)
	reCLIPortLong      = regexp.MustCompile(`(?i)--port(?:=|\s+)(\d{2,5})\b`)
	reCLIPortShort     = regexp.MustCompile(`(?:^|\s)-p\s+(\d{2,5})\b`)
	reEnvPortInline    = regexp.MustCompile(`(?i)\b(?:PORT|SERVER_PORT|VITE_PORT)\s*=\s*["']?(\d{2,5})["']?`)
	reDjangoRunserver  = regexp.MustCompile(`(?i)manage\.py\s+runserver(?:\s+(?:[\w.\[\]:]+:)?(\d{2,5}))?\b`)
	rePyPortArg        = regexp.MustCompile(`(?i)\b(?:server_)?port\s*=\s*(\d{2,5})\b`)
	reJSServerBlock    = regexp.MustCompile(`(?s)\b(?:server|devServer)\s*:\s*\{([^}]*)\}`)
	reJSPortProp       = regexp.MustCompile(`\bport\s*:\s*(?:Number\([^)]*\)\s*\|\|\s*|parseInt\([^)]*\)\s*\|\|\s*)?(\d{2,5})\b`)
	rePlaceholderPort  = regexp.MustCompile(`\$\{[^:}]+:(\d{2,5})\}`)
	reSpringPropsPort  = regexp.MustCompile(`(?m)^\s*server\.port\s*[:=]\s*(.+?)\s*$`)
	reSpringActiveProp = regexp.MustCompile(`(?m)^\s*spring\.profiles\.active\s*[:=]\s*([^\s#]+)`)
)

func isValidPort(p int) bool {
	return p >= 1 && p <= 65535
}

func parsePortNumber(raw string) int {
	s := strings.TrimSpace(raw)
	s = strings.Trim(s, `"'`)
	if m := rePlaceholderPort.FindStringSubmatch(s); len(m) == 2 {
		s = m[1]
	}
	n, err := strconv.Atoi(s)
	if err != nil || !isValidPort(n) {
		return 0
	}
	return n
}

// extractPortFromCommandLine inspects a command line (or raw npm script) for explicit port flags.
func extractPortFromCommandLine(cmdLine string) int {
	trimmed := strings.TrimSpace(cmdLine)
	if trimmed == "" {
		return 0
	}
	lower := strings.ToLower(trimmed)

	if m := reCLIServerPort.FindStringSubmatch(trimmed); len(m) == 2 {
		if p := parsePortNumber(m[1]); p > 0 {
			return p
		}
	}
	if m := reCLIPortLong.FindStringSubmatch(trimmed); len(m) == 2 {
		if p := parsePortNumber(m[1]); p > 0 {
			return p
		}
	}
	// Avoid false positives on docker -p, mkdir -p, etc.
	if !strings.Contains(lower, "docker") && !strings.Contains(lower, "mkdir") {
		if m := reCLIPortShort.FindStringSubmatch(trimmed); len(m) == 2 {
			if p := parsePortNumber(m[1]); p > 0 {
				return p
			}
		}
	}
	if m := reEnvPortInline.FindStringSubmatch(trimmed); len(m) == 2 {
		if p := parsePortNumber(m[1]); p > 0 {
			return p
		}
	}
	if m := reDjangoRunserver.FindStringSubmatch(trimmed); len(m) >= 2 && m[1] != "" {
		if p := parsePortNumber(m[1]); p > 0 {
			return p
		}
	}
	return 0
}

// detectEnvFilePort scans .env.development / .env.local / .env for common port keys.
func detectEnvFilePort(dirPath string, preferredKeys ...string) int {
	keys := preferredKeys
	if len(keys) == 0 {
		keys = []string{"PORT", "VITE_PORT", "SERVER_PORT", "APP_PORT"}
	}
	envFiles := []string{".env.development.local", ".env.development", ".env.local", ".env"}
	keyVals := make(map[string]int)

	for _, name := range envFiles {
		data, err := os.ReadFile(filepath.Join(dirPath, name))
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			line = strings.TrimPrefix(line, "export ")
			eq := strings.IndexByte(line, '=')
			if eq <= 0 {
				continue
			}
			k := strings.ToUpper(strings.TrimSpace(line[:eq]))
			v := strings.TrimSpace(line[eq+1:])
			if hashIdx := strings.Index(v, " #"); hashIdx >= 0 {
				v = strings.TrimSpace(v[:hashIdx])
			}
			if _, exists := keyVals[k]; !exists {
				if p := parsePortNumber(v); p > 0 {
					keyVals[k] = p
				}
			}
		}
	}

	for _, k := range keys {
		if p, ok := keyVals[strings.ToUpper(k)]; ok && p > 0 {
			return p
		}
	}
	return 0
}

// detectFrontendConfigPort inspects Vite / Vue / Nuxt / Webpack configs in dirPath.
func detectFrontendConfigPort(dirPath string) int {
	candidates := []string{
		"vite.config.ts",
		"vite.config.js",
		"vite.config.mts",
		"vite.config.mjs",
		"vite.config.cjs",
		"vue.config.js",
		"vue.config.cjs",
		"vue.config.mjs",
		"nuxt.config.ts",
		"nuxt.config.js",
		"nuxt.config.mjs",
		"webpack.config.js",
		"webpack.config.ts",
		"webpack.config.cjs",
		"webpack.config.mjs",
	}
	for _, name := range candidates {
		data, err := os.ReadFile(filepath.Join(dirPath, name))
		if err != nil {
			continue
		}
		text := string(data)
		if blocks := reJSServerBlock.FindAllStringSubmatch(text, -1); len(blocks) > 0 {
			for _, b := range blocks {
				if len(b) >= 2 {
					if pm := reJSPortProp.FindStringSubmatch(b[1]); len(pm) == 2 {
						if p := parsePortNumber(pm[1]); p > 0 {
							return p
						}
					}
				}
			}
		}
	}
	return 0
}

// detectNodeScriptExpectedPort determines the expected port for a package.json dev script.
func detectNodeScriptExpectedPort(dirPath string, pkg packageJSON, scriptName, rawScript, category string) int {
	if category != "dev" {
		return 0
	}
	if p := extractPortFromCommandLine(rawScript); p > 0 {
		return p
	}
	lowerRaw := strings.ToLower(rawScript)
	lowerName := strings.ToLower(scriptName)
	if lowerName == "preview" || strings.Contains(lowerRaw, "vite preview") {
		if p := detectFrontendConfigPort(dirPath); p > 0 {
			return p
		}
		return 4173
	}

	if p := detectFrontendConfigPort(dirPath); p > 0 {
		return p
	}
	if p := detectEnvFilePort(dirPath, "VITE_PORT", "PORT", "APP_PORT"); p > 0 {
		return p
	}

	hasDep := func(dep string) bool {
		if _, ok := pkg.Dependencies[dep]; ok {
			return true
		}
		if _, ok := pkg.DevDependencies[dep]; ok {
			return true
		}
		return false
	}

	// Only apply framework defaults when the script actually looks like a web dev server
	switch {
	case strings.Contains(lowerRaw, "vite") || (hasDep("vite") && (lowerName == "dev" || lowerName == "serve")):
		return 5173
	case strings.Contains(lowerRaw, "next dev") || strings.Contains(lowerRaw, "next start") || (hasDep("next") && (lowerName == "dev" || lowerName == "start")):
		return 3000
	case strings.Contains(lowerRaw, "nuxt") || (hasDep("nuxt") && lowerName == "dev"):
		return 3000
	case strings.Contains(lowerRaw, "vue-cli-service serve"):
		return 8080
	case strings.Contains(lowerRaw, "webpack") && strings.Contains(lowerRaw, "serve"):
		return 8080
	}
	return 0
}

// detectSpringBootPort extracts server.port from Spring Boot application.yml/yaml/properties (supporting active profile overrides).
func detectSpringBootPort(dirPath string, isWeb bool) int {
	resDirs := []string{
		filepath.Join(dirPath, "src", "main", "resources"),
		filepath.Join(dirPath, "config"),
		dirPath,
	}

	for _, resDir := range resDirs {
		if !dirExists(resDir) {
			continue
		}
		basePort, activeProfile := readSpringConfig(resDir, "")
		if activeProfile != "" {
			// Support comma-separated profiles; take the last profile that defines server.port
			profiles := strings.Split(activeProfile, ",")
			for i := len(profiles) - 1; i >= 0; i-- {
				prof := strings.TrimSpace(profiles[i])
				if prof == "" {
					continue
				}
				if profPort, _ := readSpringConfig(resDir, prof); profPort > 0 {
					return profPort
				}
			}
		}
		if basePort > 0 {
			return basePort
		}
	}

	if p := detectEnvFilePort(dirPath, "SERVER_PORT", "PORT"); p > 0 {
		return p
	}
	if isWeb {
		return 8080
	}
	return 0
}

func readSpringConfig(resDir, profile string) (port int, activeProfile string) {
	suffix := ""
	if profile != "" {
		suffix = "-" + profile
	}
	for _, ext := range []string{".yml", ".yaml"} {
		p := filepath.Join(resDir, "application"+suffix+ext)
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		yp, ya := parseSpringYAML(data)
		if activeProfile == "" && ya != "" {
			activeProfile = ya
		}
		if yp > 0 {
			return yp, activeProfile
		}
	}

	propPath := filepath.Join(resDir, "application"+suffix+".properties")
	if data, err := os.ReadFile(propPath); err == nil {
		text := string(data)
		if m := reSpringActiveProp.FindStringSubmatch(text); len(m) == 2 && activeProfile == "" {
			activeProfile = strings.TrimSpace(m[1])
		}
		if m := reSpringPropsPort.FindStringSubmatch(text); len(m) == 2 {
			if pp := parsePortNumber(m[1]); pp > 0 {
				return pp, activeProfile
			}
		}
	}
	return 0, activeProfile
}

func parseSpringYAML(data []byte) (port int, activeProfile string) {
	var doc map[string]any
	if err := yaml.Unmarshal(data, &doc); err != nil || doc == nil {
		return 0, ""
	}
	if srv, ok := doc["server"].(map[string]any); ok {
		if rawPort, exists := srv["port"]; exists {
			switch v := rawPort.(type) {
			case int:
				if isValidPort(v) {
					port = v
				}
			case string:
				port = parsePortNumber(v)
			}
		}
	}
	if springObj, ok := doc["spring"].(map[string]any); ok {
		if profiles, ok := springObj["profiles"].(map[string]any); ok {
			if act, ok := profiles["active"].(string); ok {
				activeProfile = strings.TrimSpace(act)
			}
		}
	}
	return port, activeProfile
}

// detectPythonEntryPort extracts port from a Python entry script, CLI command, .env, or framework default.
func detectPythonEntryPort(dirPath, entryFile, cmdStr, framework string) int {
	if p := extractPortFromCommandLine(cmdStr); p > 0 {
		return p
	}
	if entryFile != "" {
		content := readFileTailOrHead(filepath.Join(dirPath, entryFile), 24576)
		if m := rePyPortArg.FindStringSubmatch(content); len(m) == 2 {
			if p := parsePortNumber(m[1]); p > 0 {
				return p
			}
		}
	}
	if p := detectEnvFilePort(dirPath, "PORT", "SERVER_PORT", "APP_PORT"); p > 0 {
		return p
	}
	switch strings.ToLower(framework) {
	case "fastapi", "django":
		return 8000
	case "flask":
		return 5000
	case "streamlit":
		return 8501
	case "gradio":
		return 7860
	}
	return 0
}
