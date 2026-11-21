package appservice

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"graviton/internal/oauth"
)

const oauthLoginTimeout = 5 * time.Minute

// OAuthStartResult contains the generated authorization URL and session metadata.
type OAuthStartResult struct {
	AuthURL     string `json:"authUrl"`
	State       string `json:"state"`
	RedirectURI string `json:"redirectUri"`
}

// OAuthCompletionEvent is emitted when an asynchronous browser OAuth login finishes or fails.
type OAuthCompletionEvent struct {
	Account   *AccountDisplay `json:"account,omitempty"`
	Error     string          `json:"error,omitempty"`
	Cancelled bool            `json:"cancelled,omitempty"`
}

// ImportItemResult represents the outcome of importing a single refresh token.
type ImportItemResult struct {
	InputLabel string          `json:"inputLabel"`
	Success    bool            `json:"success"`
	Account    *AccountDisplay `json:"account,omitempty"`
	Error      string          `json:"error,omitempty"`
}

// BatchImportResult summarizes a refresh-token import operation.
type BatchImportResult struct {
	Total   int                `json:"total"`
	Success int                `json:"success"`
	Failed  int                `json:"failed"`
	Results []ImportItemResult `json:"results"`
}

// TokenImportItem represents a parsed refresh token entry ready for import.
type TokenImportItem struct {
	Label        string
	RefreshToken string
}

type oauthLoginSession struct {
	state       string
	redirectURI string
	listener    net.Listener
	server      *http.Server
	timer       *time.Timer
	mu          sync.Mutex
	closed      bool
}

func (sess *oauthLoginSession) markClosed() bool {
	sess.mu.Lock()
	defer sess.mu.Unlock()
	if sess.closed {
		return false
	}
	sess.closed = true
	if sess.timer != nil {
		sess.timer.Stop()
	}
	if sess.server != nil {
		// Shutdown gracefully in background if called from an active handler, or Close after brief wait
		srv := sess.server
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			_ = srv.Shutdown(ctx)
		}()
	} else if sess.listener != nil {
		_ = sess.listener.Close()
	}
	return true
}

func generateRandomState() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// StartOAuthLogin starts a temporary localhost HTTP callback server and returns the Google OAuth URL.
// When the browser completes the callback, onComplete is invoked asynchronously.
func (s *AppService) StartOAuthLogin(onComplete func(OAuthCompletionEvent)) (*OAuthStartResult, error) {
	state, err := generateRandomState()
	if err != nil {
		return nil, NewAppError("OAUTH_STATE_ERROR", fmt.Sprintf("生成 OAuth state 失败: %v", err))
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, NewAppError("OAUTH_LISTEN_ERROR", fmt.Sprintf("启动本地 OAuth 回调监听失败: %v", err))
	}

	addr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		_ = ln.Close()
		return nil, NewAppError("OAUTH_LISTEN_ERROR", "无法解析本地回调监听端口")
	}

	redirectURI := fmt.Sprintf("http://127.0.0.1:%d/oauth-callback", addr.Port)
	authURL := s.oauthSvc.BuildAuthURL(redirectURI, state)

	sess := &oauthLoginSession{
		state:       state,
		redirectURI: redirectURI,
		listener:    ln,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/oauth-callback", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if errParam := strings.TrimSpace(q.Get("error")); errParam != "" {
			errDesc := strings.TrimSpace(q.Get("error_description"))
			msg := errParam
			if errDesc != "" {
				msg = fmt.Sprintf("%s: %s", errParam, errDesc)
			}
			writeOAuthCallbackHTML(w, false, "授权未完成", msg)
			if sess.markClosed() {
				s.clearOAuthSession(sess)
				if onComplete != nil {
					go onComplete(OAuthCompletionEvent{Error: fmt.Sprintf("Google 授权失败: %s", msg)})
				}
			}
			return
		}

		gotState := strings.TrimSpace(q.Get("state"))
		if gotState != sess.state {
			writeOAuthCallbackHTML(w, false, "授权校验失败", "OAuth state 不匹配，请返回 Graviton 重试。")
			return
		}

		code := strings.TrimSpace(q.Get("code"))
		if code == "" {
			writeOAuthCallbackHTML(w, false, "授权失败", "回调地址中缺少 authorization code。")
			return
		}

		writeOAuthCallbackHTML(w, true, "授权成功", "已收到 Google 授权，正在同步账号信息与配额。您可以关闭此页面返回 Graviton。")

		if sess.markClosed() {
			s.clearOAuthSession(sess)
			go func() {
				acc, err := s.completeOAuthCode(code, redirectURI)
				if onComplete != nil {
					if err != nil {
						onComplete(OAuthCompletionEvent{Error: err.Error()})
					} else {
						onComplete(OAuthCompletionEvent{Account: acc})
					}
				}
			}()
		}
	})

	sess.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	sess.timer = time.AfterFunc(oauthLoginTimeout, func() {
		if sess.markClosed() {
			s.clearOAuthSession(sess)
			if onComplete != nil {
				onComplete(OAuthCompletionEvent{Error: "OAuth 登录等待超时，请重试"})
			}
		}
	})

	// Replace any previous pending session
	s.oauthMu.Lock()
	prev := s.oauthSess
	s.oauthSess = sess
	s.oauthMu.Unlock()
	if prev != nil {
		prev.markClosed()
	}

	go func() {
		if serveErr := sess.server.Serve(ln); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			if sess.markClosed() {
				s.clearOAuthSession(sess)
				if onComplete != nil {
					onComplete(OAuthCompletionEvent{Error: fmt.Sprintf("本地回调服务异常退出: %v", serveErr)})
				}
			}
		}
	}()

	return &OAuthStartResult{
		AuthURL:     authURL,
		State:       state,
		RedirectURI: redirectURI,
	}, nil
}

// CancelOAuthLogin cancels the currently active OAuth login session, if any.
func (s *AppService) CancelOAuthLogin() {
	s.oauthMu.Lock()
	sess := s.oauthSess
	s.oauthSess = nil
	s.oauthMu.Unlock()
	if sess != nil {
		sess.markClosed()
	}
}

func (s *AppService) clearOAuthSession(target *oauthLoginSession) {
	s.oauthMu.Lock()
	if s.oauthSess == target {
		s.oauthSess = nil
	}
	s.oauthMu.Unlock()
}

// CompleteOAuthWithCallbackURL allows manually completing an active OAuth login by pasting
// the redirected localhost callback URL (or query string containing code & state).
func (s *AppService) CompleteOAuthWithCallbackURL(rawInput string) (*AccountDisplay, error) {
	trimmed := strings.TrimSpace(rawInput)
	if trimmed == "" {
		return nil, NewAppError("INVALID_CALLBACK_URL", "请粘贴完整的回调 URL")
	}

	var query url.Values
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		parsed, err := url.Parse(trimmed)
		if err != nil {
			return nil, NewAppError("INVALID_CALLBACK_URL", fmt.Sprintf("回调 URL 格式无效: %v", err))
		}
		query = parsed.Query()
	} else {
		qStr := strings.TrimPrefix(trimmed, "?")
		parsed, err := url.ParseQuery(qStr)
		if err != nil {
			return nil, NewAppError("INVALID_CALLBACK_URL", fmt.Sprintf("回调参数格式无效: %v", err))
		}
		query = parsed
	}

	if errParam := strings.TrimSpace(query.Get("error")); errParam != "" {
		return nil, NewAppError("OAUTH_DENIED", fmt.Sprintf("Google 授权未完成: %s", errParam))
	}

	code := strings.TrimSpace(query.Get("code"))
	if code == "" {
		return nil, NewAppError("INVALID_CALLBACK_URL", "回调 URL 中未找到 code 参数")
	}

	s.oauthMu.Lock()
	sess := s.oauthSess
	s.oauthMu.Unlock()

	if sess == nil {
		return nil, NewAppError("OAUTH_NO_SESSION", "当前没有进行中的 OAuth 登录会话，请重新发起登录")
	}

	gotState := strings.TrimSpace(query.Get("state"))
	if gotState != "" && gotState != sess.state {
		return nil, NewAppError("OAUTH_STATE_MISMATCH", "回调 URL 中的 state 与当前登录会话不匹配")
	}

	redirectURI := sess.redirectURI
	if !sess.markClosed() {
		return nil, NewAppError("OAUTH_SESSION_CLOSED", "当前 OAuth 登录会话已结束，请重新发起登录")
	}
	s.clearOAuthSession(sess)

	return s.completeOAuthCode(code, redirectURI)
}

func (s *AppService) completeOAuthCode(code, redirectURI string) (*AccountDisplay, error) {
	lock, err := s.tryLock()
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	tokenResp, err := s.oauthSvc.ExchangeCode(ctx, code, redirectURI)
	if err != nil {
		if errors.Is(err, oauth.ErrInvalidGrant) {
			return nil, NewAppError("INVALID_GRANT", "授权码已失效或已被使用，请重新登录")
		}
		return nil, NewAppError("OAUTH_EXCHANGE_FAILED", fmt.Sprintf("换取 OAuth Token 失败: %v", err))
	}

	if strings.TrimSpace(tokenResp.RefreshToken) == "" {
		return nil, NewAppError("MISSING_REFRESH_TOKEN", "Google 未返回 refresh_token，请在授权页重新同意权限后重试")
	}

	payload := oauth.BuildCredentialPayload(tokenResp, "")
	return s.saveAccountFromCredential(ctx, payload, false)
}

// ImportRefreshTokens parses single, multi-line, or JSON-formatted refresh tokens and imports them.
func (s *AppService) ImportRefreshTokens(rawInput string) (*BatchImportResult, error) {
	items, err := ParseRefreshTokenInputs(rawInput)
	if err != nil {
		return nil, NewAppError("INVALID_IMPORT_INPUT", err.Error())
	}

	lock, err := s.tryLock()
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	result := &BatchImportResult{
		Total:   len(items),
		Results: make([]ImportItemResult, 0, len(items)),
	}

	for _, item := range items {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		tokenResp, err := s.oauthSvc.RefreshToken(ctx, item.RefreshToken)
		if err != nil {
			cancel()
			errMsg := err.Error()
			if errors.Is(err, oauth.ErrInvalidGrant) {
				errMsg = "Refresh Token 已失效或被撤销 (invalid_grant)"
			}
			result.Failed++
			result.Results = append(result.Results, ImportItemResult{
				InputLabel: item.Label,
				Success:    false,
				Error:      errMsg,
			})
			continue
		}

		payload := oauth.BuildCredentialPayload(tokenResp, item.RefreshToken)
		acc, saveErr := s.saveAccountFromCredential(ctx, payload, false)
		cancel()

		if saveErr != nil {
			result.Failed++
			result.Results = append(result.Results, ImportItemResult{
				InputLabel: item.Label,
				Success:    false,
				Error:      saveErr.Error(),
			})
			continue
		}

		result.Success++
		result.Results = append(result.Results, ImportItemResult{
			InputLabel: acc.Email,
			Success:    true,
			Account:    acc,
		})
	}

	return result, nil
}

// ParseRefreshTokenInputs parses a single refresh token, newline/comma-separated tokens,
// or Antigravity-Manager JSON export payloads into deduplicated TokenImportItems.
func ParseRefreshTokenInputs(rawInput string) ([]TokenImportItem, error) {
	trimmed := strings.TrimSpace(rawInput)
	if trimmed == "" {
		return nil, errors.New("请输入 Refresh Token 或 JSON 内容")
	}

	var items []TokenImportItem
	if strings.HasPrefix(trimmed, "[") || strings.HasPrefix(trimmed, "{") {
		parsed, err := parseRefreshTokenJSON(trimmed)
		if err != nil {
			return nil, fmt.Errorf("JSON 解析失败: %w", err)
		}
		items = parsed
	} else {
		items = parseRefreshTokenLines(trimmed)
	}

	seen := make(map[string]struct{}, len(items))
	deduped := make([]TokenImportItem, 0, len(items))
	for _, it := range items {
		tok := strings.TrimSpace(it.RefreshToken)
		if tok == "" {
			continue
		}
		if _, exists := seen[tok]; exists {
			continue
		}
		seen[tok] = struct{}{}
		label := strings.TrimSpace(it.Label)
		if label == "" {
			label = maskTokenLabel(tok)
		}
		deduped = append(deduped, TokenImportItem{
			Label:        label,
			RefreshToken: tok,
		})
	}

	if len(deduped) == 0 {
		return nil, errors.New("未识别到有效的 Refresh Token")
	}
	return deduped, nil
}

type jsonTokenRecord struct {
	Email            string `json:"email"`
	Name             string `json:"name"`
	RefreshToken     string `json:"refresh_token"`
	RefreshTokenAlt  string `json:"refreshToken"`
	Token            *struct {
		RefreshToken    string `json:"refresh_token"`
		RefreshTokenAlt string `json:"refreshToken"`
	} `json:"token"`
}

func (r jsonTokenRecord) extractToken() string {
	for _, candidate := range []string{r.RefreshToken, r.RefreshTokenAlt} {
		if strings.TrimSpace(candidate) != "" {
			return strings.TrimSpace(candidate)
		}
	}
	if r.Token != nil {
		for _, candidate := range []string{r.Token.RefreshToken, r.Token.RefreshTokenAlt} {
			if strings.TrimSpace(candidate) != "" {
				return strings.TrimSpace(candidate)
			}
		}
	}
	return ""
}

func parseRefreshTokenJSON(raw string) ([]TokenImportItem, error) {
	if strings.HasPrefix(raw, "{") {
		var single jsonTokenRecord
		if err := json.Unmarshal([]byte(raw), &single); err != nil {
			return nil, err
		}
		tok := single.extractToken()
		if tok == "" {
			return nil, errors.New("JSON 对象中未找到 refresh_token 字段")
		}
		label := strings.TrimSpace(single.Email)
		if label == "" {
			label = strings.TrimSpace(single.Name)
		}
		return []TokenImportItem{{Label: label, RefreshToken: tok}}, nil
	}

	// Try array of objects first
	var records []jsonTokenRecord
	if err := json.Unmarshal([]byte(raw), &records); err == nil {
		items := make([]TokenImportItem, 0, len(records))
		for _, rec := range records {
			tok := rec.extractToken()
			if tok == "" {
				continue
			}
			label := strings.TrimSpace(rec.Email)
			if label == "" {
				label = strings.TrimSpace(rec.Name)
			}
			items = append(items, TokenImportItem{Label: label, RefreshToken: tok})
		}
		if len(items) > 0 {
			return items, nil
		}
	}

	// Fallback: array of raw token strings
	var strList []string
	if err := json.Unmarshal([]byte(raw), &strList); err != nil {
		return nil, err
	}
	items := make([]TokenImportItem, 0, len(strList))
	for _, s := range strList {
		s = strings.TrimSpace(s)
		if s != "" {
			items = append(items, TokenImportItem{RefreshToken: s})
		}
	}
	return items, nil
}

func parseRefreshTokenLines(raw string) []TokenImportItem {
	lines := strings.Split(raw, "\n")
	items := make([]TokenImportItem, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Handle optional "email|token" or "email,token" formats
		var label, token string
		for _, sep := range []string{"|", ",", "\t"} {
			if strings.Contains(line, sep) {
				parts := strings.Split(line, sep)
				if len(parts) >= 2 {
					first := strings.TrimSpace(parts[0])
					last := strings.TrimSpace(parts[len(parts)-1])
					if strings.HasPrefix(last, "1//") {
						label = first
						token = last
						break
					}
					if strings.HasPrefix(first, "1//") {
						token = first
						break
					}
				}
			}
		}
		if token == "" {
			token = strings.Trim(line, `"' ,`)
		} else {
			token = strings.Trim(token, `"' ,`)
		}
		if token != "" {
			items = append(items, TokenImportItem{Label: label, RefreshToken: token})
		}
	}
	return items
}

func maskTokenLabel(token string) string {
	if len(token) <= 14 {
		return token
	}
	return token[:8] + "..." + token[len(token)-4:]
}

func writeOAuthCallbackHTML(w http.ResponseWriter, success bool, title, detail string) {
	statusColor := "#16a34a"
	badge := "✓"
	if !success {
		statusColor = "#dc2626"
		badge = "!"
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if !success {
		w.WriteHeader(http.StatusBadRequest)
	}
	_, _ = fmt.Fprintf(w, `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>%s - Graviton</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; max-width: 420px; text-align: center; box-shadow: 0 20px 50px rgba(0,0,0,0.4); }
    .badge { width: 48px; height: 48px; border-radius: 9999px; background: %s; color: #fff; font-size: 24px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    p { font-size: 14px; color: #cbd5e1; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">%s</div>
    <h1>%s</h1>
    <p>%s</p>
  </div>
</body>
</html>`, html.EscapeString(title), statusColor, badge, html.EscapeString(title), html.EscapeString(detail))
}
