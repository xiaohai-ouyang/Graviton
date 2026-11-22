//go:build windows

package updater

import (
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/sys/windows/registry"
)

// NewHTTPClient builds an HTTP client honoring environment proxies first, then the
// Windows system proxy (HKCU Internet Settings). timeout == 0 means no total timeout
// (for large downloads); dial/TLS/response-header timeouts still guard against hangs.
func NewHTTPClient(timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.TLSHandshakeTimeout = 15 * time.Second
	transport.ResponseHeaderTimeout = 30 * time.Second
	transport.Proxy = proxyFunc
	return &http.Client{Timeout: timeout, Transport: transport}
}

func proxyFunc(req *http.Request) (*url.URL, error) {
	if envURL, err := http.ProxyFromEnvironment(req); err != nil || envURL != nil {
		return envURL, err
	}
	return systemProxyForRequest(req)
}

type systemProxyConfig struct {
	server    string
	overrides []string
	bypassLocal bool
}

func readSystemProxy() *systemProxyConfig {
	key, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Internet Settings`, registry.QUERY_VALUE)
	if err != nil {
		return nil
	}
	defer key.Close()

	enabled, _, err := key.GetIntegerValue("ProxyEnable")
	if err != nil || enabled != 1 {
		return nil
	}
	server, _, err := key.GetStringValue("ProxyServer")
	if err != nil || strings.TrimSpace(server) == "" {
		return nil
	}

	cfg := &systemProxyConfig{server: strings.TrimSpace(server)}
	if override, _, err := key.GetStringValue("ProxyOverride"); err == nil {
		for _, item := range strings.Split(override, ";") {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			if item == "<local>" {
				cfg.bypassLocal = true
				continue
			}
			cfg.overrides = append(cfg.overrides, strings.ToLower(item))
		}
	}
	return cfg
}

func systemProxyForRequest(req *http.Request) (*url.URL, error) {
	cfg := readSystemProxy()
	if cfg == nil {
		return nil, nil
	}
	host := strings.ToLower(req.URL.Hostname())
	if cfg.bypassLocal && !strings.Contains(host, ".") {
		return nil, nil
	}
	for _, pattern := range cfg.overrides {
		if matchProxyOverride(host, pattern) {
			return nil, nil
		}
	}

	server := cfg.server
	if strings.Contains(server, "=") {
		// Per-protocol form: "http=host:port;https=host:port"
		server = ""
		for _, part := range strings.Split(cfg.server, ";") {
			kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
			if len(kv) == 2 && strings.EqualFold(kv[0], req.URL.Scheme) {
				server = strings.TrimSpace(kv[1])
				break
			}
		}
		if server == "" {
			return nil, nil
		}
	}
	if !strings.Contains(server, "://") {
		server = "http://" + server
	}
	return url.Parse(server)
}

// matchProxyOverride supports "example.com", "*.example.com" and "host:port" style entries.
func matchProxyOverride(host, pattern string) bool {
	if h, _, ok := strings.Cut(pattern, ":"); ok && h != "" && !strings.Contains(h, "*") {
		pattern = h
	}
	if strings.HasPrefix(pattern, "*.") {
		suffix := pattern[1:] // ".example.com"
		return strings.HasSuffix(host, suffix) || host == pattern[2:]
	}
	return host == pattern
}