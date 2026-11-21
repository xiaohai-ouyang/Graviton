package envmgr

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"graviton/internal/cred"
	"graviton/internal/storage"

	"github.com/google/uuid"
)

const (
	aiCredTarget       = "Graviton/AI/OpenAICompat"
	legacyAICredTarget = "CodeTool/AI/OpenAICompat"
)

// AIConfig holds settings for the optional OpenAI-compatible lightweight assistant.
type AIConfig struct {
	Enabled bool   `json:"enabled"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
}

// LoadAIConfig reads AI settings from settings.toml and the API key from Windows Credential Manager.
func LoadAIConfig(sm *storage.StorageManager) AIConfig {
	cfg := AIConfig{
		BaseURL: "https://api.openai.com/v1",
		Model:   "gpt-4o-mini",
	}
	if sm != nil {
		if sf, _, err := sm.LoadSettings(); err == nil {
			cfg.Enabled = sf.AIEnabled
			if strings.TrimSpace(sf.AIBaseURL) != "" {
				cfg.BaseURL = strings.TrimSpace(sf.AIBaseURL)
			}
			if strings.TrimSpace(sf.AIModel) != "" {
				cfg.Model = strings.TrimSpace(sf.AIModel)
			}
		}
	}
	if raw, err := cred.ReadRaw(aiCredTarget); err == nil {
		cfg.APIKey = string(raw)
	} else if legacyRaw, legacyErr := cred.ReadRaw(legacyAICredTarget); legacyErr == nil {
		cfg.APIKey = string(legacyRaw)
		_ = cred.WriteRaw(aiCredTarget, "openai-compat", legacyRaw)
	}
	return cfg
}

// SaveAIConfig persists AI settings to settings.toml and API key to Windows Credential Manager.
func SaveAIConfig(sm *storage.StorageManager, cfg AIConfig) error {
	if sm == nil {
		return errors.New("storage manager not initialized")
	}
	sf, _, err := sm.LoadSettings()
	if err != nil {
		return err
	}
	sf.AIEnabled = cfg.Enabled
	sf.AIBaseURL = strings.TrimSpace(cfg.BaseURL)
	sf.AIModel = strings.TrimSpace(cfg.Model)
	if err := sm.SaveSettings(sf); err != nil {
		return err
	}

	key := strings.TrimSpace(cfg.APIKey)
	if key == "" {
		_ = cred.DeleteCredential(aiCredTarget)
		_ = cred.DeleteCredential(legacyAICredTarget)
		return nil
	}
	return cred.WriteRaw(aiCredTarget, "openai-compat", []byte(key))
}

func (c AIConfig) IsReady() bool {
	return c.Enabled && strings.TrimSpace(c.BaseURL) != "" && strings.TrimSpace(c.Model) != ""
}

func resolveChatCompletionsURL(baseURL string) string {
	u := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(u, "/chat/completions") {
		return u
	}
	return u + "/chat/completions"
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// TestAIConfig sends a minimal request to verify the OpenAI-compatible endpoint works.
func TestAIConfig(ctx context.Context, cfg AIConfig) error {
	if strings.TrimSpace(cfg.BaseURL) == "" || strings.TrimSpace(cfg.Model) == "" {
		return errors.New("请先填写 Base URL 和模型名称")
	}
	_, err := callChatCompletion(ctx, cfg, []chatMessage{
		{Role: "user", Content: "Reply with OK"},
	}, 16, 15*time.Second)
	return err
}

type aiSuggestedCommand struct {
	Name     string `json:"name"`
	Command  string `json:"command"`
	Cwd      string `json:"cwd"`
	Category string `json:"category"`
	Pinned   bool   `json:"pinned"`
}

type aiAnalyzePayload struct {
	Commands []aiSuggestedCommand `json:"commands"`
}

// AnalyzeProjectWithAI calls the configured lightweight model to refine Chinese labels,
// select core pinned commands, and discover any missing launch commands from README/configs.
func AnalyzeProjectWithAI(ctx context.Context, cfg AIConfig, proj storage.ProjectRecord) ([]storage.ProjectCommand, error) {
	if !cfg.IsReady() {
		return nil, errors.New("AI 辅助未启用或配置不完整")
	}

	contextText := buildProjectContextForAI(proj)
	systemPrompt := `你是开发项目启动指令分析助手。根据提供的项目配置文件、README摘要与本地扫描出的候选命令，整理出最实用、准确的项目指令列表。
要求：
1. 只返回合法 JSON 对象，格式为：{"commands":[{"name":"中文名称","command":"可执行命令","cwd":"相对目录(根目录为空字符串)","category":"dev|build|test|lint|other","pinned":true}]}
2. name 使用简短清晰的中文（例如："启动桌面"、"启动 Agent"、"启动开发"、"Windows 打包"）。
3. 将最常用的 2~6 条开发启动或打包指令设为 pinned: true，其余测试/检查/辅助脚本设为 pinned: false。
4. 不要编造项目里不存在的脚本命令；如果 README 中有重要启动命令而本地扫描遗漏了，可以补充。
5. 不要输出任何 Markdown 代码块以外的解释文字。`

	raw, err := callChatCompletion(ctx, cfg, []chatMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: contextText},
	}, 1500, 45*time.Second)
	if err != nil {
		return nil, err
	}

	cleaned := extractJSONBlock(raw)
	var parsed aiAnalyzePayload
	if err := json.Unmarshal([]byte(cleaned), &parsed); err != nil {
		return nil, fmt.Errorf("AI 返回格式解析失败: %w", err)
	}
	if len(parsed.Commands) == 0 {
		return nil, errors.New("AI 未返回有效指令")
	}

	return mergeAICommands(proj.Commands, parsed.Commands), nil
}

func mergeAICommands(existing []storage.ProjectCommand, suggested []aiSuggestedCommand) []storage.ProjectCommand {
	existingByKey := make(map[string]storage.ProjectCommand, len(existing))
	for _, c := range existing {
		key := strings.TrimSpace(c.Cwd) + "::" + strings.TrimSpace(c.Command)
		existingByKey[key] = c
	}

	out := make([]storage.ProjectCommand, 0, len(existing)+len(suggested))
	usedKeys := make(map[string]bool)

	// Keep manual commands untouched at the top or in place
	for _, c := range existing {
		if c.Source == "manual" {
			key := strings.TrimSpace(c.Cwd) + "::" + strings.TrimSpace(c.Command)
			usedKeys[key] = true
			out = append(out, c)
		}
	}

	for _, s := range suggested {
		cmdStr := strings.TrimSpace(s.Command)
		if cmdStr == "" {
			continue
		}
		cwd := strings.TrimSpace(s.Cwd)
		key := cwd + "::" + cmdStr
		if usedKeys[key] {
			continue
		}
		usedKeys[key] = true

		cat := normalizeCategory(s.Category)
		name := strings.TrimSpace(s.Name)
		if name == "" {
			name = cmdStr
		}

		if prev, ok := existingByKey[key]; ok {
			prev.Name = name
			prev.Category = cat
			prev.Pinned = s.Pinned
			prev.Source = "ai"
			out = append(out, prev)
		} else {
			out = append(out, storage.ProjectCommand{
				ID:         uuid.NewString(),
				Name:       name,
				Command:    cmdStr,
				Cwd:        cwd,
				Category:   cat,
				Pinned:     s.Pinned,
				Source:     "ai",
				SubProject: cwd,
			})
		}
	}

	// Preserve remaining rule commands that AI omitted (unpinned)
	for _, c := range existing {
		key := strings.TrimSpace(c.Cwd) + "::" + strings.TrimSpace(c.Command)
		if !usedKeys[key] {
			usedKeys[key] = true
			c.Pinned = false
			out = append(out, c)
		}
	}

	return out
}

func normalizeCategory(cat string) string {
	switch strings.ToLower(strings.TrimSpace(cat)) {
	case "dev", "build", "test", "lint":
		return strings.ToLower(strings.TrimSpace(cat))
	default:
		return "other"
	}
}

func buildProjectContextForAI(proj storage.ProjectRecord) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("项目名称: %s\n技术栈: %s\n\n", proj.Name, strings.Join(proj.TechStack, ", ")))

	appendSnippet := func(title, relPath string, maxBytes int) {
		p := filepath.Join(proj.Path, relPath)
		data, err := os.ReadFile(p)
		if err != nil {
			return
		}
		text := string(data)
		if len(text) > maxBytes {
			text = text[:maxBytes] + "\n...(truncated)"
		}
		sb.WriteString(fmt.Sprintf("--- %s ---\n%s\n\n", title, text))
	}

	appendSnippet("package.json", "package.json", 2500)
	appendSnippet("wails.json", "wails.json", 1000)
	appendSnippet("pyproject.toml", "pyproject.toml", 1500)
	appendSnippet("requirements.txt", "requirements.txt", 1000)
	appendSnippet("README.md", "README.md", 2500)

	if venv := detectPythonVenv(proj.Path); venv != "" {
		sb.WriteString(fmt.Sprintf("检测到本地 Python 虚拟环境: %s\n\n", venv))
	}

	sb.WriteString("--- 本地规则已提取的候选指令 ---\n")
	for _, c := range proj.Commands {
		sb.WriteString(fmt.Sprintf("- name=%q command=%q cwd=%q category=%q pinned=%v\n", c.Name, c.Command, c.Cwd, c.Category, c.Pinned))
	}
	return sb.String()
}

func extractJSONBlock(raw string) string {
	s := strings.TrimSpace(raw)
	if idx := strings.Index(s, "```json"); idx != -1 {
		s = s[idx+7:]
		if end := strings.Index(s, "```"); end != -1 {
			s = s[:end]
		}
	} else if idx := strings.Index(s, "```"); idx != -1 {
		s = s[idx+3:]
		if end := strings.Index(s, "```"); end != -1 {
			s = s[:end]
		}
	}
	return strings.TrimSpace(s)
}

func callChatCompletion(ctx context.Context, cfg AIConfig, messages []chatMessage, maxTokens int, timeout time.Duration) (string, error) {
	endpoint := resolveChatCompletionsURL(cfg.BaseURL)
	reqBody := chatRequest{
		Model:       strings.TrimSpace(cfg.Model),
		Messages:    messages,
		Temperature: 0.2,
		MaxTokens:   maxTokens,
	}
	data, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(cfg.APIKey) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.APIKey))
	}

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求 AI 接口失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("AI 接口返回错误 (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var parsed chatResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("解析 AI 响应失败: %w", err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return "", errors.New(parsed.Error.Message)
	}
	if len(parsed.Choices) == 0 {
		return "", errors.New("AI 返回内容为空")
	}
	return parsed.Choices[0].Message.Content, nil
}
