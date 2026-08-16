package manager

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRunner struct {
	run func(context.Context, ...string) (CommandResult, error)
}

func (f fakeRunner) Run(ctx context.Context, args ...string) (CommandResult, error) {
	return f.run(ctx, args...)
}

func newTestConfig(t *testing.T, runner Runner) Config {
	t.Helper()
	directory := t.TempDir()
	ipv4 := filepath.Join(directory, "ipv4-forward")
	ipv6 := filepath.Join(directory, "ipv6-forward")
	if err := os.WriteFile(ipv4, []byte("0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ipv6, []byte("0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	config := DefaultConfig()
	config.Runner = runner
	config.TempDir = directory
	config.IPv4ForwardPath = ipv4
	config.IPv6ForwardPath = ipv6
	config.PackageVersion = "1.102.2-fnos.0.1"
	config.TailscaleVersion = "1.102.2"
	return config
}

func performRequest(t *testing.T, server http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	return response
}

func decodeData[T any](t *testing.T, response *httptest.ResponseRecorder) T {
	t.Helper()
	var payload struct {
		OK   bool `json:"ok"`
		Data T    `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, response.Body.String())
	}
	if !payload.OK {
		t.Fatalf("response was not ok: %s", response.Body.String())
	}
	return payload.Data
}

func TestStatusBuildsDeviceSummary(t *testing.T) {
	statusJSON := `{
  "Version":"1.102.2-t0123456","BackendState":"Running","HaveNodeKey":true,
  "TailscaleIPs":["100.64.0.1"],"CurrentTailnet":{"Name":"example.com"},
  "Self":{"ID":"self-id","HostName":"fnos","OS":"linux","TailscaleIPs":["100.64.0.1"],"Online":true},
  "Peer":{"nodekey:b":{"ID":"peer-b","HostName":"offline","OS":"windows","TailscaleIPs":["100.64.0.3"]},
          "nodekey:a":{"ID":"peer-a","HostName":"online","OS":"linux","TailscaleIPs":["100.64.0.2"],"Online":true,"CurAddr":"192.0.2.1:41641"}}
}`
	runner := fakeRunner{run: func(_ context.Context, args ...string) (CommandResult, error) {
		if len(args) > 0 && args[0] == "get" {
			return CommandResult{Stdout: []byte("true\n")}, nil
		}
		return CommandResult{Stdout: []byte(statusJSON)}, nil
	}}
	server := NewServer(newTestConfig(t, runner))
	response := performRequest(t, server, http.MethodGet, "/api/status", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	data := decodeData[statusResponse](t, response)
	if !data.Connected || !data.LoggedIn || !data.ExitNodeAdvertised {
		t.Fatalf("unexpected state: %+v", data)
	}
	if data.OnlineCount != 2 || data.TotalCount != 3 {
		t.Fatalf("unexpected counts: online=%d total=%d", data.OnlineCount, data.TotalCount)
	}
	if len(data.Devices) != 3 || !data.Devices[0].Self || data.Devices[1].Name != "online" {
		t.Fatalf("unexpected device order: %+v", data.Devices)
	}
}

func TestHostnameValidationPreventsArgumentInjection(t *testing.T) {
	called := false
	runner := fakeRunner{run: func(_ context.Context, args ...string) (CommandResult, error) {
		called = true
		return CommandResult{}, nil
	}}
	server := NewServer(newTestConfig(t, runner))
	response := performRequest(t, server, http.MethodPost, "/api/hostname", `{"hostname":"nas; reboot"}`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if called {
		t.Fatal("runner was called for an invalid hostname")
	}
}

func TestHostnameUsesOneFixedArgument(t *testing.T) {
	var received []string
	runner := fakeRunner{run: func(_ context.Context, args ...string) (CommandResult, error) {
		received = append([]string(nil), args...)
		return CommandResult{}, nil
	}}
	server := NewServer(newTestConfig(t, runner))
	response := performRequest(t, server, http.MethodPost, "/api/hostname", `{"hostname":"fnos-nas"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if strings.Join(received, "|") != "set|--hostname=fnos-nas" {
		t.Fatalf("unexpected command: %#v", received)
	}
}

func TestLogoutUsesOneFixedCommand(t *testing.T) {
	var received []string
	runner := fakeRunner{run: func(_ context.Context, args ...string) (CommandResult, error) {
		received = append([]string(nil), args...)
		return CommandResult{}, nil
	}}
	server := NewServer(newTestConfig(t, runner))
	response := performRequest(t, server, http.MethodPost, "/api/logout", `{}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if strings.Join(received, "|") != "logout" {
		t.Fatalf("unexpected command: %#v", received)
	}
	data := decodeData[map[string]bool](t, response)
	if data["logged_in"] {
		t.Fatalf("unexpected logout response: %#v", data)
	}
}

func TestAuthKeyIsPassedByTemporaryFile(t *testing.T) {
	const secret = "tskey-auth-abcdefghijklmnopqrstuvwxyz123456"
	var commandArgs []string
	var stored string
	runner := fakeRunner{run: func(_ context.Context, args ...string) (CommandResult, error) {
		commandArgs = append([]string(nil), args...)
		for _, arg := range args {
			if strings.HasPrefix(arg, "--auth-key=file:") {
				content, err := os.ReadFile(strings.TrimPrefix(arg, "--auth-key=file:"))
				if err != nil {
					t.Fatalf("read temporary key: %v", err)
				}
				stored = string(content)
			}
		}
		return CommandResult{}, nil
	}}
	config := newTestConfig(t, runner)
	server := NewServer(config)
	response := performRequest(t, server, http.MethodPost, "/api/login/auth-key", `{"auth_key":"`+secret+`"}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if stored != secret {
		t.Fatalf("temporary key mismatch: %q", stored)
	}
	if strings.Contains(strings.Join(commandArgs, " "), secret) {
		t.Fatal("secret was exposed in command arguments")
	}
	entries, err := os.ReadDir(config.TempDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".auth-key-") {
			t.Fatalf("temporary key was not deleted: %s", entry.Name())
		}
	}
}

func TestCrossSiteMutationIsRejected(t *testing.T) {
	runner := fakeRunner{run: func(_ context.Context, args ...string) (CommandResult, error) {
		t.Fatalf("runner unexpectedly called with %v", args)
		return CommandResult{}, nil
	}}
	server := NewServer(newTestConfig(t, runner))
	request := httptest.NewRequest(http.MethodPost, "/api/down", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Sec-Fetch-Site", "cross-site")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestLatencyParsesNanosecondsAndIgnoresStderrWarning(t *testing.T) {
	runner := fakeRunner{run: func(_ context.Context, args ...string) (CommandResult, error) {
		return CommandResult{
			Stdout: []byte(`{"UDP":true,"IPv4":true,"PreferredDERP":2,"RegionLatency":{"1":45000000,"2":21500000}}`),
			Stderr: []byte("# Warning: JSON format is not stable"),
		}, nil
	}}
	server := NewServer(newTestConfig(t, runner))
	response := performRequest(t, server, http.MethodGet, "/api/latency", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	data := decodeData[latencyResponse](t, response)
	if data.NearestMS != 21.5 || data.PreferredDERP != 2 || !data.UDP {
		t.Fatalf("unexpected latency: %+v", data)
	}
}

func TestExitNodeEnablesForwardingAndUsesBooleanFlag(t *testing.T) {
	var received []string
	runner := fakeRunner{run: func(_ context.Context, args ...string) (CommandResult, error) {
		received = append([]string(nil), args...)
		return CommandResult{}, nil
	}}
	config := newTestConfig(t, runner)
	server := NewServer(config)
	response := performRequest(t, server, http.MethodPost, "/api/exit-node", `{"enabled":true}`)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if !forwardingEnabled(config.IPv4ForwardPath) || !forwardingEnabled(config.IPv6ForwardPath) {
		t.Fatal("forwarding was not enabled")
	}
	if strings.Join(received, "|") != "set|--advertise-exit-node=true" {
		t.Fatalf("unexpected command: %#v", received)
	}
}

func TestIndexHasStrictSecurityHeaders(t *testing.T) {
	runner := fakeRunner{run: func(_ context.Context, args ...string) (CommandResult, error) {
		return CommandResult{}, nil
	}}
	server := NewServer(newTestConfig(t, runner))
	response := performRequest(t, server, http.MethodGet, "/", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d", response.Code)
	}
	if !strings.Contains(response.Header().Get("Content-Security-Policy"), "default-src 'self'") {
		t.Fatal("missing content security policy")
	}
	body, _ := io.ReadAll(response.Result().Body)
	if !strings.Contains(string(body), "Tailscale for fnOS") {
		t.Fatal("unexpected index document")
	}
}

func TestCGIScriptPrefixIsRemoved(t *testing.T) {
	runner := fakeRunner{run: func(_ context.Context, args ...string) (CommandResult, error) {
		return CommandResult{}, nil
	}}
	server := NewServer(newTestConfig(t, runner))
	response := performRequest(t, server, http.MethodGet, "/cgi/ThirdParty/TailscaleFnos/index.cgi/", "")
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	response = performRequest(t, server, http.MethodGet, "/cgi/ThirdParty/TailscaleFnos/index.cgi/assets/app.js", "")
	if response.Code != http.StatusOK {
		t.Fatalf("asset status=%d body=%s", response.Code, response.Body.String())
	}
}
