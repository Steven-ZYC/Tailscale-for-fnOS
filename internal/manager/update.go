package manager

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var packageVersionPattern = regexp.MustCompile(`^v?([0-9]+)\.([0-9]+)\.([0-9]+)-fnos\.([0-9]+(?:\.[0-9]+)*)$`)

type githubRelease struct {
	TagName     string `json:"tag_name"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
}

type updateResponse struct {
	Current     string `json:"current"`
	Latest      string `json:"latest,omitempty"`
	Available   bool   `json:"available"`
	Published   bool   `json:"published"`
	ReleaseURL  string `json:"release_url"`
	PublishedAt string `json:"published_at,omitempty"`
	CheckedAt   string `json:"checked_at"`
}

func (s *Server) handleUpdate(writer http.ResponseWriter, request *http.Request) {
	response := updateResponse{
		Current:    s.config.PackageVersion,
		ReleaseURL: "https://github.com/" + s.config.GitHubRepository + "/releases",
		CheckedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	apiURL := "https://api.github.com/repos/" + s.config.GitHubRepository + "/releases/latest"
	releaseRequest, err := http.NewRequestWithContext(request.Context(), http.MethodGet, apiURL, nil)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "update_check_failed", "无法创建版本检测请求")
		return
	}
	releaseRequest.Header.Set("Accept", "application/vnd.github+json")
	releaseRequest.Header.Set("User-Agent", "Tailscale-for-fnOS/"+s.config.PackageVersion)
	releaseResponse, err := s.config.HTTPClient.Do(releaseRequest)
	if err != nil {
		writeError(writer, http.StatusBadGateway, "update_check_failed", "无法连接 GitHub 检查新版本")
		return
	}
	defer releaseResponse.Body.Close()
	if releaseResponse.StatusCode == http.StatusNotFound {
		writeData(writer, http.StatusOK, response)
		return
	}
	if releaseResponse.StatusCode != http.StatusOK {
		writeError(writer, http.StatusBadGateway, "update_check_failed", fmt.Sprintf("GitHub 返回 HTTP %d", releaseResponse.StatusCode))
		return
	}
	var release githubRelease
	if err := json.NewDecoder(releaseResponse.Body).Decode(&release); err != nil {
		writeError(writer, http.StatusBadGateway, "update_check_failed", "无法解析 GitHub 版本信息")
		return
	}
	response.Latest = strings.TrimPrefix(release.TagName, "v")
	response.Published = response.Latest != ""
	response.PublishedAt = release.PublishedAt
	if strings.HasPrefix(release.HTMLURL, "https://github.com/"+s.config.GitHubRepository+"/releases/") {
		response.ReleaseURL = release.HTMLURL
	}
	if comparison, ok := comparePackageVersions(response.Current, response.Latest); ok {
		response.Available = comparison < 0
	}
	writeData(writer, http.StatusOK, response)
}

func comparePackageVersions(left, right string) (int, bool) {
	leftParts, ok := parsePackageVersion(left)
	if !ok {
		return 0, false
	}
	rightParts, ok := parsePackageVersion(right)
	if !ok {
		return 0, false
	}
	length := len(leftParts)
	if len(rightParts) > length {
		length = len(rightParts)
	}
	for index := 0; index < length; index++ {
		var leftValue, rightValue int
		if index < len(leftParts) {
			leftValue = leftParts[index]
		}
		if index < len(rightParts) {
			rightValue = rightParts[index]
		}
		if leftValue < rightValue {
			return -1, true
		}
		if leftValue > rightValue {
			return 1, true
		}
	}
	return 0, true
}

func parsePackageVersion(value string) ([]int, bool) {
	matches := packageVersionPattern.FindStringSubmatch(strings.TrimSpace(value))
	if matches == nil {
		return nil, false
	}
	values := make([]int, 0, 6)
	for _, part := range matches[1:4] {
		number, err := strconv.Atoi(part)
		if err != nil {
			return nil, false
		}
		values = append(values, number)
	}
	for _, part := range strings.Split(matches[4], ".") {
		number, err := strconv.Atoi(part)
		if err != nil {
			return nil, false
		}
		values = append(values, number)
	}
	return values, true
}
