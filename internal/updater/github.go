package updater

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"graviton/internal/buildinfo"
)

const (
	DefaultOwner      = "xiaohai-ouyang"
	DefaultRepo       = "Graviton"
	DefaultAPIBaseURL = "https://api.github.com"
)

// ReleaseInfo is the sanitized release metadata surfaced to the frontend.
type ReleaseInfo struct {
	Version      string `json:"version"`
	Title        string `json:"title"`
	Notes        string `json:"notes"`
	URL          string `json:"url"`
	PublishedAt  string `json:"publishedAt"`
	AssetName    string `json:"assetName"`
	AssetURL     string `json:"assetUrl"`
	AssetSize    int64  `json:"assetSize"`
	ChecksumURL  string `json:"checksumUrl"`
	IsPrerelease bool   `json:"isPrerelease"`
}

type githubAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

type githubRelease struct {
	TagName     string        `json:"tag_name"`
	Name        string        `json:"name"`
	Body        string        `json:"body"`
	HTMLURL     string        `json:"html_url"`
	PublishedAt string        `json:"published_at"`
	Draft       bool          `json:"draft"`
	Prerelease  bool          `json:"prerelease"`
	Assets      []githubAsset `json:"assets"`
}

// GitHubClient fetches release metadata with ETag caching to stay under the API rate limit.
type GitHubClient struct {
	Owner      string
	Repo       string
	APIBaseURL string
	UserAgent  string
	HTTPClient *http.Client

	lastETag    string
	lastRelease *githubRelease
	lastList    []githubRelease
	lastListTag string
}

// NewGitHubClient creates a client with defaults; httpClient may be nil.
func NewGitHubClient(version string, httpClient *http.Client) *GitHubClient {
	if httpClient == nil {
		httpClient = NewHTTPClient(apiTimeout)
	}
	return &GitHubClient{
		Owner:      DefaultOwner,
		Repo:       DefaultRepo,
		APIBaseURL: DefaultAPIBaseURL,
		UserAgent:  "Graviton/" + version,
		HTTPClient: httpClient,
	}
}

// ErrNotModified is returned internally when GitHub answers 304 to an If-None-Match request.
var errNotModified = errors.New("not modified")

func (g *GitHubClient) getJSON(ctx context.Context, path, etag string, out any) (newETag string, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, g.APIBaseURL+path, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", g.UserAgent)
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := g.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求 GitHub 失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		return etag, errNotModified
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GitHub API 返回异常状态 %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", fmt.Errorf("读取 GitHub 响应失败: %w", err)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return "", fmt.Errorf("解析 GitHub 响应失败: %w", err)
	}
	return resp.Header.Get("ETag"), nil
}

// FetchLatestRelease returns the highest eligible release for the channel, or nil when
// no release is newer than currentVersion. mode selects installer vs portable assets.
func (g *GitHubClient) FetchLatestRelease(ctx context.Context, channel, currentVersion string, mode InstallMode) (*ReleaseInfo, error) {
	var release *githubRelease
	if channel == buildinfo.ChannelStable {
		var latest githubRelease
		etag, err := g.getJSON(ctx, fmt.Sprintf("/repos/%s/%s/releases/latest", g.Owner, g.Repo), g.lastETag, &latest)
		switch {
		case errors.Is(err, errNotModified):
			release = g.lastRelease
		case err != nil:
			return nil, err
		default:
			g.lastETag = etag
			g.lastRelease = &latest
			release = &latest
		}
		if release == nil || release.Draft || !IsReleaseEligible(channel, versionFromTagName(release.TagName), release.Prerelease) {
			return nil, nil
		}
	} else {
		var list []githubRelease
		path := fmt.Sprintf("/repos/%s/%s/releases?per_page=15", g.Owner, g.Repo)
		etag, err := g.getJSON(ctx, path, g.lastListTag, &list)
		switch {
		case errors.Is(err, errNotModified):
			list = g.lastList
		case err != nil:
			return nil, err
		default:
			g.lastListTag = etag
			g.lastList = list
		}
		for i := range list {
			r := &list[i]
			if r.Draft || !IsReleaseEligible(channel, versionFromTagName(r.TagName), r.Prerelease) {
				continue
			}
			if release == nil {
				release = r
				continue
			}
			if cmp, err := CompareVersion(versionFromTagName(r.TagName), versionFromTagName(release.TagName)); err == nil && cmp > 0 {
				release = r
			}
		}
		if release == nil {
			return nil, nil
		}
	}

	version := versionFromTagName(release.TagName)
	if cmp, err := CompareVersion(version, currentVersion); err != nil || cmp <= 0 {
		return nil, nil
	}

	suffix := "portable"
	if mode == ModeNSIS {
		suffix = "installer"
	}
	assetName := fmt.Sprintf("Graviton-v%s-windows-amd64-%s.exe", version, suffix)

	info := &ReleaseInfo{
		Version:      version,
		Title:        strings.TrimSpace(release.Name),
		Notes:        CleanReleaseNotes(release.Body),
		URL:          release.HTMLURL,
		PublishedAt:  release.PublishedAt,
		AssetName:    assetName,
		IsPrerelease: release.Prerelease,
	}
	for _, asset := range release.Assets {
		switch asset.Name {
		case assetName:
			info.AssetURL = asset.BrowserDownloadURL
			info.AssetSize = asset.Size
		case "SHA256SUMS.txt":
			info.ChecksumURL = asset.BrowserDownloadURL
		}
	}
	if info.AssetURL == "" {
		return nil, fmt.Errorf("Release v%s 缺少资产 %s", version, assetName)
	}
	if info.ChecksumURL == "" {
		return nil, fmt.Errorf("Release v%s 缺少 SHA256SUMS.txt 校验文件，已拒绝更新", version)
	}
	return info, nil
}

// CleanReleaseNotes strips the static "### 下载与防篡改验真" download section from release notes.
func CleanReleaseNotes(body string) string {
	normalized := strings.ReplaceAll(body, "\r\n", "\n")
	if idx := strings.Index(normalized, "### 下载与防篡改验真"); idx >= 0 {
		normalized = normalized[:idx]
	}
	return strings.TrimSpace(normalized)
}