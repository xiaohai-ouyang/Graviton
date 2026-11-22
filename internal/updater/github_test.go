package updater

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func releaseJSON(tag string, prerelease, draft bool, assets []string) githubRelease {
	r := githubRelease{
		TagName:     tag,
		Name:        "Graviton " + tag,
		Body:        "## 标题\n\n- 变更一\n\n### 下载与防篡改验真\n\n- 安装包下载引导",
		HTMLURL:     "https://github.com/xiaohai-ouyang/Graviton/releases/tag/" + tag,
		PublishedAt: "2026-11-20T00:00:00Z",
		Draft:       draft,
		Prerelease:  prerelease,
	}
	for _, name := range assets {
		r.Assets = append(r.Assets, githubAsset{
			Name:               name,
			Size:               1234,
			BrowserDownloadURL: "https://github.com/xiaohai-ouyang/Graviton/releases/download/" + tag + "/" + name,
		})
	}
	return r
}

func newTestGitHubClient(baseURL string) *GitHubClient {
	g := NewGitHubClient("0.1.0-rc.8", nil)
	g.APIBaseURL = baseURL
	return g
}

func TestFetchLatestRelease_StableChannel(t *testing.T) {
	var gotPath, gotAccept, gotUA string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotAccept, gotUA = r.URL.Path, r.Header.Get("Accept"), r.Header.Get("User-Agent")
		rel := releaseJSON("v0.2.0", false, false, []string{
			"Graviton-v0.2.0-windows-amd64-installer.exe",
			"Graviton-v0.2.0-windows-amd64-portable.exe",
			"SHA256SUMS.txt",
		})
		_ = json.NewEncoder(w).Encode(rel)
	}))
	defer srv.Close()

	g := newTestGitHubClient(srv.URL)
	info, err := g.FetchLatestRelease(context.Background(), "stable", "0.1.0", ModePortable)
	require.NoError(t, err)
	require.NotNil(t, info)
	assert.Equal(t, "/repos/xiaohai-ouyang/Graviton/releases/latest", gotPath)
	assert.Equal(t, "application/vnd.github+json", gotAccept)
	assert.Equal(t, "Graviton/0.1.0-rc.8", gotUA)
	assert.Equal(t, "0.2.0", info.Version)
	assert.Equal(t, "Graviton-v0.2.0-windows-amd64-portable.exe", info.AssetName)
	assert.Contains(t, info.AssetURL, "portable.exe")
	assert.NotEmpty(t, info.ChecksumURL)
	assert.NotContains(t, info.Notes, "下载与防篡改验真")
	assert.Contains(t, info.Notes, "变更一")
}

func TestFetchLatestRelease_NSISAssetSelection(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := releaseJSON("v0.2.0", false, false, []string{
			"Graviton-v0.2.0-windows-amd64-installer.exe",
			"SHA256SUMS.txt",
		})
		_ = json.NewEncoder(w).Encode(rel)
	}))
	defer srv.Close()

	info, err := newTestGitHubClient(srv.URL).FetchLatestRelease(context.Background(), "stable", "0.1.0", ModeNSIS)
	require.NoError(t, err)
	require.NotNil(t, info)
	assert.Equal(t, "Graviton-v0.2.0-windows-amd64-installer.exe", info.AssetName)
}

func TestFetchLatestRelease_RCChannelPicksHighest(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path + "?" + r.URL.RawQuery
		list := []githubRelease{
			releaseJSON("v0.1.0-rc.9", true, false, []string{"Graviton-v0.1.0-rc.9-windows-amd64-portable.exe", "SHA256SUMS.txt"}),
			releaseJSON("v0.1.0-rc.10", true, true, []string{"Graviton-v0.1.0-rc.10-windows-amd64-portable.exe", "SHA256SUMS.txt"}), // draft: skipped
			releaseJSON("v0.1.0-rc.8", true, false, []string{"Graviton-v0.1.0-rc.8-windows-amd64-portable.exe", "SHA256SUMS.txt"}),
		}
		_ = json.NewEncoder(w).Encode(list)
	}))
	defer srv.Close()

	info, err := newTestGitHubClient(srv.URL).FetchLatestRelease(context.Background(), "rc", "0.1.0-rc.8", ModePortable)
	require.NoError(t, err)
	require.NotNil(t, info)
	assert.Equal(t, "0.1.0-rc.9", info.Version)
	assert.Contains(t, gotPath, "releases?per_page=15")
}

func TestFetchLatestRelease_NotNewerReturnsNil(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]githubRelease{releaseJSON("v0.1.0-rc.8", true, false, nil)})
	}))
	defer srv.Close()

	info, err := newTestGitHubClient(srv.URL).FetchLatestRelease(context.Background(), "rc", "0.1.0-rc.8", ModePortable)
	require.NoError(t, err)
	assert.Nil(t, info)
}

func TestFetchLatestRelease_ETag304UsesCache(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.Header.Get("If-None-Match") == `"tag-1"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"tag-1"`)
		_ = json.NewEncoder(w).Encode(releaseJSON("v0.2.0", false, false, []string{
			"Graviton-v0.2.0-windows-amd64-portable.exe", "SHA256SUMS.txt",
		}))
	}))
	defer srv.Close()

	g := newTestGitHubClient(srv.URL)
	first, err := g.FetchLatestRelease(context.Background(), "stable", "0.1.0", ModePortable)
	require.NoError(t, err)
	require.NotNil(t, first)

	second, err := g.FetchLatestRelease(context.Background(), "stable", "0.1.0", ModePortable)
	require.NoError(t, err)
	require.NotNil(t, second)
	assert.Equal(t, first.Version, second.Version)
	assert.Equal(t, 2, hits)
}

func TestFetchLatestRelease_MissingChecksumRejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(releaseJSON("v0.2.0", false, false, []string{
			"Graviton-v0.2.0-windows-amd64-portable.exe",
		}))
	}))
	defer srv.Close()

	_, err := newTestGitHubClient(srv.URL).FetchLatestRelease(context.Background(), "stable", "0.1.0", ModePortable)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "SHA256SUMS.txt")
}

func TestCleanReleaseNotes(t *testing.T) {
	body := "## 新功能\r\n\r\n- 项 A\r\n\r\n### 下载与防篡改验真\r\n\r\n- 安装包\r\n- 校验"
	got := CleanReleaseNotes(body)
	assert.Equal(t, "## 新功能\n\n- 项 A", got)

	assert.Equal(t, "纯说明", CleanReleaseNotes("纯说明"))
}