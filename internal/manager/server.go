package manager

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

//go:embed web/*
var webFiles embed.FS

var (
	hostnamePattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$`)
	loginURLPattern = regexp.MustCompile(`https://login\.tailscale\.com/[A-Za-z0-9_?&=./:%+-]+`)
)

type Config struct {
	TailscaleBinary  string
	SocketPath       string
	TempDir          string
	IconPath         string
	IPv4ForwardPath  string
	IPv6ForwardPath  string
	PackageVersion   string
	TailscaleVersion string
	GitHubRepository string
	Runner           Runner
	HTTPClient       *http.Client
}

func DefaultConfig() Config {
	return Config{
		TailscaleBinary:  "/var/apps/TailscaleFnos/target/bin/tailscale",
		SocketPath:       "/var/apps/TailscaleFnos/tmp/tailscaled.sock",
		TempDir:          "/var/apps/TailscaleFnos/tmp",
		IconPath:         "/var/apps/TailscaleFnos/target/ui/images/icon_64.png",
		IPv4ForwardPath:  "/proc/sys/net/ipv4/ip_forward",
		IPv6ForwardPath:  "/proc/sys/net/ipv6/conf/all/forwarding",
		PackageVersion:   "dev",
		TailscaleVersion: "unknown",
		GitHubRepository: "Steven-ZYC/Tailscale-for-fnOS",
		HTTPClient:       &http.Client{Timeout: 8 * time.Second},
	}
}

type Server struct {
	config Config
	runner Runner
	mux    *http.ServeMux
}

func NewServer(config Config) *Server {
	if config.Runner == nil {
		config.Runner = CLIRunner{Binary: config.TailscaleBinary, Socket: config.SocketPath}
	}
	if config.HTTPClient == nil {
		config.HTTPClient = &http.Client{Timeout: 8 * time.Second}
	}
	server := &Server{config: config, runner: config.Runner, mux: http.NewServeMux()}
	server.routes()
	return server
}

func (s *Server) routes() {
	staticFS, _ := fs.Sub(webFiles, "web")
	s.mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.FS(staticFS))))
	s.mux.HandleFunc("GET /icon.png", s.handleIcon)
	s.mux.HandleFunc("GET /api/status", s.handleStatus)
	s.mux.HandleFunc("GET /api/latency", s.handleLatency)
	s.mux.HandleFunc("GET /api/update", s.handleUpdate)
	s.mux.HandleFunc("POST /api/connect", s.handleConnect)
	s.mux.HandleFunc("POST /api/down", s.handleDown)
	s.mux.HandleFunc("POST /api/logout", s.handleLogout)
	s.mux.HandleFunc("POST /api/login/browser", s.handleBrowserLogin)
	s.mux.HandleFunc("POST /api/login/auth-key", s.handleAuthKeyLogin)
	s.mux.HandleFunc("POST /api/hostname", s.handleHostname)
	s.mux.HandleFunc("POST /api/exit-node", s.handleExitNode)
	s.mux.HandleFunc("GET /", s.handleIndex)
}

func (s *Server) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	request = normalizeCGIPath(request)
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.Header().Set("X-Frame-Options", "SAMEORIGIN")
	writer.Header().Set("Referrer-Policy", "same-origin")
	writer.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	writer.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'")
	if strings.HasPrefix(request.URL.Path, "/api/") || request.URL.Path == "/" {
		writer.Header().Set("Cache-Control", "no-store")
	}
	s.mux.ServeHTTP(writer, request)
}

func normalizeCGIPath(request *http.Request) *http.Request {
	const entry = "/index.cgi"
	entryIndex := strings.Index(request.URL.Path, entry)
	if entryIndex < 0 {
		return request
	}
	path := request.URL.Path[entryIndex+len(entry):]
	if path == "" {
		path = "/"
	}
	clone := request.Clone(request.Context())
	clonedURL := *request.URL
	clonedURL.Path = path
	clonedURL.RawPath = ""
	clone.URL = &clonedURL
	return clone
}

func (s *Server) handleIndex(writer http.ResponseWriter, request *http.Request) {
	if request.URL.Path != "/" && request.URL.Path != "" {
		http.NotFound(writer, request)
		return
	}
	data, err := webFiles.ReadFile("web/index.html")
	if err != nil {
		http.Error(writer, "UI unavailable", http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = writer.Write(data)
}

func (s *Server) handleIcon(writer http.ResponseWriter, request *http.Request) {
	data, err := os.ReadFile(s.config.IconPath)
	if err != nil {
		http.NotFound(writer, request)
		return
	}
	writer.Header().Set("Content-Type", "image/png")
	writer.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = writer.Write(data)
}

type statusResponse struct {
	BackendState       string   `json:"backend_state"`
	Connected          bool     `json:"connected"`
	LoggedIn           bool     `json:"logged_in"`
	AuthURL            string   `json:"auth_url,omitempty"`
	Tailnet            string   `json:"tailnet,omitempty"`
	TailscaleIPs       []string `json:"tailscale_ips"`
	Self               *Device  `json:"self,omitempty"`
	Devices            []Device `json:"devices"`
	OnlineCount        int      `json:"online_count"`
	TotalCount         int      `json:"total_count"`
	ExitNodeAdvertised bool     `json:"exit_node_advertised"`
	IPv4Forwarding     bool     `json:"ipv4_forwarding"`
	IPv6Forwarding     bool     `json:"ipv6_forwarding"`
	Health             []string `json:"health"`
	PackageVersion     string   `json:"package_version"`
	TailscaleVersion   string   `json:"tailscale_version"`
}

func (s *Server) readStatus(ctx context.Context) (statusResponse, error) {
	result, runErr := s.runner.Run(ctx, "status", "--json")
	var raw tailscaleStatus
	if err := json.Unmarshal(result.Stdout, &raw); err != nil {
		if runErr != nil {
			return statusResponse{}, fmt.Errorf("%s", commandMessage(result, runErr))
		}
		return statusResponse{}, fmt.Errorf("无法解析 Tailscale 状态：%w", err)
	}

	connected := raw.BackendState == "Running"
	loggedIn := raw.HaveNodeKey && raw.BackendState != "NeedsLogin" && raw.BackendState != "NoState"
	response := statusResponse{
		BackendState:     raw.BackendState,
		Connected:        connected,
		LoggedIn:         loggedIn,
		AuthURL:          safeLoginURL(raw.AuthURL),
		TailscaleIPs:     append([]string(nil), raw.TailscaleIPs...),
		Health:           append([]string(nil), raw.Health...),
		PackageVersion:   s.config.PackageVersion,
		TailscaleVersion: s.config.TailscaleVersion,
	}
	if raw.Version != "" {
		response.TailscaleVersion = raw.Version
	}
	if raw.CurrentTailnet != nil {
		response.Tailnet = raw.CurrentTailnet.Name
		if response.Tailnet == "" {
			response.Tailnet = raw.CurrentTailnet.MagicDNSSuffix
		}
	}
	if raw.Self != nil {
		self := deviceFromPeer("self", raw.Self, true, connected)
		response.Self = &self
		response.Devices = append(response.Devices, self)
	}
	for id, peer := range raw.Peer {
		if peer == nil {
			continue
		}
		response.Devices = append(response.Devices, deviceFromPeer(id, peer, false, connected))
	}
	sort.SliceStable(response.Devices, func(i, j int) bool {
		left, right := response.Devices[i], response.Devices[j]
		if left.Self != right.Self {
			return left.Self
		}
		if left.Online != right.Online {
			return left.Online
		}
		return strings.ToLower(left.Name) < strings.ToLower(right.Name)
	})
	for _, device := range response.Devices {
		if device.Online {
			response.OnlineCount++
		}
	}
	response.TotalCount = len(response.Devices)
	response.ExitNodeAdvertised = raw.Self != nil && raw.Self.ExitNodeOption
	if pref, err := s.runner.Run(ctx, "get", "advertise-exit-node"); err == nil {
		response.ExitNodeAdvertised = strings.EqualFold(strings.TrimSpace(string(pref.Stdout)), "true")
	}
	response.IPv4Forwarding = forwardingEnabled(s.config.IPv4ForwardPath)
	response.IPv6Forwarding = forwardingEnabled(s.config.IPv6ForwardPath)
	return response, nil
}

func (s *Server) handleStatus(writer http.ResponseWriter, request *http.Request) {
	ctx, cancel := context.WithTimeout(request.Context(), 6*time.Second)
	defer cancel()
	status, err := s.readStatus(ctx)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "daemon_unavailable", err.Error())
		return
	}
	writeData(writer, http.StatusOK, status)
}

func (s *Server) handleConnect(writer http.ResponseWriter, request *http.Request) {
	if !requireJSON(writer, request) {
		return
	}
	loginURL, err := s.runInteractiveUp(request.Context())
	if err != nil && loginURL == "" {
		writeError(writer, http.StatusBadGateway, "connect_failed", err.Error())
		return
	}
	writeData(writer, http.StatusOK, map[string]string{"auth_url": loginURL})
}

func (s *Server) handleBrowserLogin(writer http.ResponseWriter, request *http.Request) {
	if !requireJSON(writer, request) {
		return
	}
	loginURL, err := s.runInteractiveUp(request.Context())
	if err != nil && loginURL == "" {
		writeError(writer, http.StatusBadGateway, "login_failed", err.Error())
		return
	}
	writeData(writer, http.StatusOK, map[string]string{"auth_url": loginURL})
}

func (s *Server) runInteractiveUp(parent context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(parent, 12*time.Second)
	defer cancel()
	result, runErr := s.runner.Run(ctx, "up", "--timeout=8s")
	loginURL := safeLoginURLFromText(combinedOutput(result))
	if loginURL == "" {
		statusCtx, statusCancel := context.WithTimeout(parent, 3*time.Second)
		defer statusCancel()
		if status, err := s.readStatus(statusCtx); err == nil {
			loginURL = status.AuthURL
			if status.Connected {
				return "", nil
			}
		}
	}
	if runErr != nil && loginURL == "" {
		return "", errors.New(commandMessage(result, runErr))
	}
	return loginURL, nil
}

func (s *Server) handleAuthKeyLogin(writer http.ResponseWriter, request *http.Request) {
	if !requireJSON(writer, request) {
		return
	}
	var input struct {
		AuthKey string `json:"auth_key"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	key := strings.TrimSpace(input.AuthKey)
	if !strings.HasPrefix(key, "tskey-auth-") || len(key) < 24 || len(key) > 512 || strings.ContainsAny(key, "\r\n\x00") {
		writeError(writer, http.StatusBadRequest, "invalid_auth_key", "请输入有效的 Tailscale Auth Key（以 tskey-auth- 开头）")
		return
	}
	if err := os.MkdirAll(s.config.TempDir, 0700); err != nil {
		writeError(writer, http.StatusInternalServerError, "temp_unavailable", "无法创建安全的临时目录")
		return
	}
	keyFile, err := os.CreateTemp(s.config.TempDir, ".auth-key-")
	if err != nil {
		writeError(writer, http.StatusInternalServerError, "temp_unavailable", "无法创建安全的密钥文件")
		return
	}
	keyPath := keyFile.Name()
	defer os.Remove(keyPath)
	_ = keyFile.Chmod(0600)
	if _, err := keyFile.WriteString(key); err != nil {
		_ = keyFile.Close()
		writeError(writer, http.StatusInternalServerError, "temp_unavailable", "无法写入安全的密钥文件")
		return
	}
	if err := keyFile.Close(); err != nil {
		writeError(writer, http.StatusInternalServerError, "temp_unavailable", "无法保存安全的密钥文件")
		return
	}

	ctx, cancel := context.WithTimeout(request.Context(), 25*time.Second)
	defer cancel()
	result, runErr := s.runner.Run(ctx, "up", "--auth-key=file:"+keyPath, "--timeout=20s")
	if runErr != nil {
		writeError(writer, http.StatusBadGateway, "login_failed", commandMessage(result, runErr))
		return
	}
	writeData(writer, http.StatusOK, map[string]bool{"connected": true})
}

func (s *Server) handleDown(writer http.ResponseWriter, request *http.Request) {
	if !requireJSON(writer, request) {
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 8*time.Second)
	defer cancel()
	result, err := s.runner.Run(ctx, "down", "--accept-risk=lose-ssh")
	if err != nil {
		writeError(writer, http.StatusBadGateway, "down_failed", commandMessage(result, err))
		return
	}
	writeData(writer, http.StatusOK, map[string]bool{"connected": false})
}

func (s *Server) handleLogout(writer http.ResponseWriter, request *http.Request) {
	if !requireJSON(writer, request) {
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 8*time.Second)
	defer cancel()
	result, err := s.runner.Run(ctx, "logout")
	if err != nil {
		writeError(writer, http.StatusBadGateway, "logout_failed", commandMessage(result, err))
		return
	}
	writeData(writer, http.StatusOK, map[string]bool{"logged_in": false})
}

func (s *Server) handleHostname(writer http.ResponseWriter, request *http.Request) {
	if !requireJSON(writer, request) {
		return
	}
	var input struct {
		Hostname string `json:"hostname"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	hostname := strings.TrimSpace(input.Hostname)
	if !hostnamePattern.MatchString(hostname) {
		writeError(writer, http.StatusBadRequest, "invalid_hostname", "设备名称需为 1–63 位英文字母、数字或连字符，且不能以连字符开头或结尾")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), 8*time.Second)
	defer cancel()
	result, err := s.runner.Run(ctx, "set", "--hostname="+hostname)
	if err != nil {
		writeError(writer, http.StatusBadGateway, "hostname_failed", commandMessage(result, err))
		return
	}
	writeData(writer, http.StatusOK, map[string]string{"hostname": hostname})
}

func (s *Server) handleExitNode(writer http.ResponseWriter, request *http.Request) {
	if !requireJSON(writer, request) {
		return
	}
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	if !decodeJSON(writer, request, &input) {
		return
	}
	if input.Enabled == nil {
		writeError(writer, http.StatusBadRequest, "invalid_request", "缺少 enabled 参数")
		return
	}
	warnings := make([]string, 0, 1)
	if *input.Enabled {
		if err := enableForwarding(s.config.IPv4ForwardPath); err != nil {
			writeError(writer, http.StatusInternalServerError, "forwarding_failed", "无法启用 IPv4 转发："+err.Error())
			return
		}
		if err := enableForwarding(s.config.IPv6ForwardPath); err != nil && !os.IsNotExist(err) {
			warnings = append(warnings, "IPv6 转发未能启用；IPv4 Exit Node 仍可继续使用")
		}
	}
	ctx, cancel := context.WithTimeout(request.Context(), 8*time.Second)
	defer cancel()
	result, err := s.runner.Run(ctx, "set", fmt.Sprintf("--advertise-exit-node=%t", *input.Enabled))
	if err != nil {
		writeError(writer, http.StatusBadGateway, "exit_node_failed", commandMessage(result, err))
		return
	}
	writeData(writer, http.StatusOK, map[string]any{"enabled": *input.Enabled, "warnings": warnings})
}

func forwardingEnabled(path string) bool {
	value, err := os.ReadFile(path)
	return err == nil && strings.TrimSpace(string(value)) == "1"
}

func enableForwarding(path string) error {
	if forwardingEnabled(path) {
		return nil
	}
	return os.WriteFile(path, []byte("1\n"), 0644)
}

func requireJSON(writer http.ResponseWriter, request *http.Request) bool {
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(request.Header.Get("Content-Type"), ";")[0]))
	if mediaType != "application/json" {
		writeError(writer, http.StatusUnsupportedMediaType, "json_required", "操作请求必须使用 application/json")
		return false
	}
	if fetchSite := request.Header.Get("Sec-Fetch-Site"); fetchSite == "cross-site" {
		writeError(writer, http.StatusForbidden, "cross_site_rejected", "已拒绝跨站操作请求")
		return false
	}
	return true
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, destination any) bool {
	decoder := json.NewDecoder(io.LimitReader(request.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid_json", "请求内容无效")
		return false
	}
	return true
}

func safeLoginURLFromText(value string) string {
	return safeLoginURL(loginURLPattern.FindString(value))
}

func safeLoginURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || !strings.EqualFold(parsed.Hostname(), "login.tailscale.com") {
		return ""
	}
	return parsed.String()
}

type envelope struct {
	OK    bool        `json:"ok"`
	Data  any         `json:"data,omitempty"`
	Error *errorValue `json:"error,omitempty"`
}

type errorValue struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeData(writer http.ResponseWriter, status int, data any) {
	writeJSON(writer, status, envelope{OK: true, Data: data})
}

func writeError(writer http.ResponseWriter, status int, code, message string) {
	writeJSON(writer, status, envelope{OK: false, Error: &errorValue{Code: code, Message: message}})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
