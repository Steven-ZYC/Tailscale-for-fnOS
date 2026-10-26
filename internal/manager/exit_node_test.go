package manager

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type exitNodeFixture struct {
	mu                                        sync.Mutex
	advertised, connected, loggedIn, approved bool
	routes                                    string
	connector                                 bool
	invalidStatus                             bool
	failSet, failUp, refuseSet, invalidGet    bool
	netfilter                                 string
	snat                                      bool
	calls                                     []string
	blockSet, releaseSet                      chan struct{}
}

func newExitNodeFixture() *exitNodeFixture {
	return &exitNodeFixture{connected: true, loggedIn: true, netfilter: "on", snat: true}
}

func (f *exitNodeFixture) Run(ctx context.Context, args ...string) (CommandResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, strings.Join(args, "|"))
	output := func(value any) (CommandResult, error) {
		data, _ := json.Marshal(value)
		return CommandResult{Stdout: data}, nil
	}
	switch args[0] {
	case "status":
		if f.invalidStatus {
			return CommandResult{}, errors.New("status unavailable")
		}
		state := "Stopped"
		if !f.loggedIn {
			state = "NeedsLogin"
		} else if f.connected {
			state = "Running"
		}
		return output(tailscaleStatus{BackendState: state, HaveNodeKey: f.loggedIn, Self: &tailscalePeer{ExitNodeOption: f.approved}})
	case "get":
		switch args[1] {
		case "advertise-exit-node":
			if f.invalidGet {
				return CommandResult{Stdout: []byte("unknown")}, nil
			}
			return output(f.advertised)
		case "advertise-routes":
			return CommandResult{Stdout: []byte(f.routes)}, nil
		case "advertise-connector":
			return output(f.connector)
		case "netfilter-mode":
			return CommandResult{Stdout: []byte(f.netfilter)}, nil
		case "snat-subnet-routes":
			return output(f.snat)
		}
	case "set":
		if args[1] == "--advertise-exit-node=true" {
			if f.blockSet != nil {
				close(f.blockSet)
				select {
				case <-f.releaseSet:
				case <-ctx.Done():
					return CommandResult{}, ctx.Err()
				}
			}
			if !f.refuseSet {
				f.advertised = true
			}
			if f.failSet {
				return CommandResult{Stderr: []byte("set failed after updating preferences")}, errors.New("exit 1")
			}
		} else if args[1] == "--advertise-exit-node=false" {
			f.advertised = false
			f.invalidGet = false
		}
		return CommandResult{}, nil
	case "up":
		f.connected = true
		if f.failUp {
			return CommandResult{Stderr: []byte("unable to connect")}, errors.New("exit 1")
		}
		return CommandResult{}, nil
	case "down":
		f.connected = false
		return CommandResult{}, nil
	}
	return CommandResult{}, errors.New("unexpected fixture command: " + strings.Join(args, " "))
}

func enableExitNode(t *testing.T, server *Server) {
	t.Helper()
	response := performRequest(t, server, http.MethodPost, "/api/exit-node", `{"enabled":true}`)
	if response.Code != http.StatusOK {
		t.Fatalf("enable: %d %s", response.Code, response.Body.String())
	}
}

func TestExitNodeEnablesMachineWithBareUpAndVerifiedReadback(t *testing.T) {
	fixture := newExitNodeFixture()
	fixture.connected = false
	config := newTestConfig(t, fixture)
	server := NewServer(config)
	enableExitNode(t, server)
	if !fixture.advertised || !fixture.connected || !forwardingEnabled(config.IPv4ForwardPath) || !forwardingEnabled(config.IPv6ForwardPath) {
		t.Fatal("machine exit node is not fully enabled")
	}
	upFound := false
	for _, call := range fixture.calls {
		if call == "up" {
			upFound = true
		}
		if strings.HasPrefix(call, "up|") {
			t.Fatalf("up must preserve custom preferences: %s", call)
		}
	}
	if !upFound {
		t.Fatal("never connected the machine")
	}
	status, err := server.readStatus(context.Background())
	if err != nil || !status.ExitNodeEnabled || status.ExitNodeApproval != "unknown" {
		t.Fatalf("unexpected verified status: %+v %v", status, err)
	}
	journal, err := server.readForwardingJournal()
	if err != nil || !journal.IPv4 || !journal.IPv6 {
		t.Fatalf("ownership missing: %+v %v", journal, err)
	}
}

func TestExitNodeDisableRestoresOwnedForwardingAfterCGIRestart(t *testing.T) {
	fixture := newExitNodeFixture()
	config := newTestConfig(t, fixture)
	enableExitNode(t, NewServer(config))
	// A fresh server simulates the next independent CGI process.
	server := NewServer(config)
	response := performRequest(t, server, http.MethodPost, "/api/exit-node", `{"enabled":false}`)
	if response.Code != http.StatusOK {
		t.Fatalf("disable: %s", response.Body.String())
	}
	if fixture.advertised || forwardingEnabled(config.IPv4ForwardPath) || forwardingEnabled(config.IPv6ForwardPath) {
		t.Fatal("owned exit node settings were left enabled")
	}
	if !fixture.connected {
		t.Fatal("disabling the exit node disconnected ordinary Tailscale")
	}
	if data := decodeData[struct{ Enabled bool }](t, response); data.Enabled {
		t.Fatal("disabled response says enabled")
	}
}

func TestExitNodeDisablePreservesPreexistingForwarding(t *testing.T) {
	fixture := newExitNodeFixture()
	config := newTestConfig(t, fixture)
	if err := os.WriteFile(config.IPv4ForwardPath, []byte("1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	server := NewServer(config)
	enableExitNode(t, server)
	response := performRequest(t, server, http.MethodPost, "/api/exit-node", `{"enabled":false}`)
	if response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	if !forwardingEnabled(config.IPv4ForwardPath) || forwardingEnabled(config.IPv6ForwardPath) {
		t.Fatal("did not preserve only the preexisting setting")
	}
}

func TestExitNodeDisablePreservesOtherRoutingServices(t *testing.T) {
	for _, dependency := range []string{"subnet", "connector", "bridge"} {
		t.Run(dependency, func(t *testing.T) {
			fixture := newExitNodeFixture()
			config := newTestConfig(t, fixture)
			server := NewServer(config)
			enableExitNode(t, server)
			switch dependency {
			case "subnet":
				fixture.routes = "192.168.1.0/24"
			case "connector":
				fixture.connector = true
			case "bridge":
				if err := os.MkdirAll(filepath.Join(config.NetworkClassPath, "docker0", "bridge"), 0700); err != nil {
					t.Fatal(err)
				}
			}
			response := performRequest(t, server, http.MethodPost, "/api/exit-node", `{"enabled":false}`)
			if response.Code != http.StatusOK {
				t.Fatal(response.Body.String())
			}
			if fixture.advertised || !forwardingEnabled(config.IPv4ForwardPath) || !forwardingEnabled(config.IPv6ForwardPath) {
				t.Fatal("exit advertisement not stopped or unrelated forwarding was disabled")
			}
			data := decodeData[struct{ Warnings []string }](t, response)
			if len(data.Warnings) == 0 {
				t.Fatal("preserved global forwarding must be explained")
			}
		})
	}
}

func TestExitNodeFailuresRollbackPreferencesForwardingAndConnection(t *testing.T) {
	for _, failure := range []string{"set", "up", "readback"} {
		t.Run(failure, func(t *testing.T) {
			fixture := newExitNodeFixture()
			fixture.connected = false
			fixture.failSet = failure == "set"
			fixture.failUp = failure == "up"
			fixture.refuseSet = failure == "readback"
			config := newTestConfig(t, fixture)
			response := performRequest(t, NewServer(config), http.MethodPost, "/api/exit-node", `{"enabled":true}`)
			if response.Code == http.StatusOK {
				t.Fatal("failed operation reported success")
			}
			if fixture.advertised || fixture.connected || forwardingEnabled(config.IPv4ForwardPath) || forwardingEnabled(config.IPv6ForwardPath) {
				t.Fatalf("partial changes left behind: %s", response.Body.String())
			}
		})
	}
}

func TestExitNodeRequiresLoginBeforeChangingMachine(t *testing.T) {
	fixture := newExitNodeFixture()
	fixture.loggedIn = false
	config := newTestConfig(t, fixture)
	response := performRequest(t, NewServer(config), http.MethodPost, "/api/exit-node", `{"enabled":true}`)
	if response.Code == http.StatusOK || fixture.advertised || forwardingEnabled(config.IPv4ForwardPath) {
		t.Fatalf("changed unauthenticated machine: %s", response.Body.String())
	}
}

func TestExitNodeDoesNotConfuseConsoleApprovalWithLocalAdvertisement(t *testing.T) {
	fixture := newExitNodeFixture()
	fixture.approved = true
	fixture.invalidGet = true
	server := NewServer(newTestConfig(t, fixture))
	status, err := server.readStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.ExitNodeStateKnown || status.ExitNodeAdvertised || status.ExitNodeEnabled || status.ExitNodeApproval != "unknown" {
		t.Fatalf("fabricated local state: %+v", status)
	}
	response := performRequest(t, server, http.MethodPost, "/api/exit-node", `{"enabled":true}`)
	if response.Code == http.StatusOK {
		t.Fatal("mutated without knowing initial preferences")
	}
}

func TestExitNodeMissingIPv6IsExplicitAndNotCreated(t *testing.T) {
	fixture := newExitNodeFixture()
	config := newTestConfig(t, fixture)
	if err := os.Remove(config.IPv6ForwardPath); err != nil {
		t.Fatal(err)
	}
	server := NewServer(config)
	response := performRequest(t, server, http.MethodPost, "/api/exit-node", `{"enabled":true}`)
	if response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	if _, err := os.Stat(config.IPv6ForwardPath); !os.IsNotExist(err) {
		t.Fatal("created a fake IPv6 kernel sysctl")
	}
	status, err := server.readStatus(context.Background())
	if err != nil || !status.ExitNodeEnabled || status.IPv6ForwardingAvailable || status.IPv6Forwarding {
		t.Fatalf("IPv6 state wrong: %+v %v", status, err)
	}
	if !strings.Contains(response.Body.String(), "IPv6") {
		t.Fatal("missing IPv6 limitation warning")
	}
}

func TestExitNodeRestorePreservesOwnershipAcrossReboot(t *testing.T) {
	fixture := newExitNodeFixture()
	config := newTestConfig(t, fixture)
	enableExitNode(t, NewServer(config))
	for _, path := range []string{config.IPv4ForwardPath, config.IPv6ForwardPath} {
		if err := os.WriteFile(path, []byte("0\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	server := NewServer(config)
	if err := server.RestoreExitNodeForwarding(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !forwardingEnabled(config.IPv4ForwardPath) || !forwardingEnabled(config.IPv6ForwardPath) {
		t.Fatal("reboot forwarding not restored")
	}
	response := performRequest(t, server, http.MethodPost, "/api/exit-node", `{"enabled":false}`)
	if response.Code != http.StatusOK || forwardingEnabled(config.IPv4ForwardPath) || forwardingEnabled(config.IPv6ForwardPath) {
		t.Fatalf("reboot lost ownership: %s", response.Body.String())
	}
}

func TestExitNodeCorruptJournalDoesNotMutateMachine(t *testing.T) {
	fixture := newExitNodeFixture()
	config := newTestConfig(t, fixture)
	if err := os.WriteFile(filepath.Join(config.StateDir, "exit-node-forwarding.json"), []byte(`{"version":99,"ipv4_owned":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	response := performRequest(t, NewServer(config), http.MethodPost, "/api/exit-node", `{"enabled":true}`)
	if response.Code == http.StatusOK || fixture.advertised || forwardingEnabled(config.IPv4ForwardPath) {
		t.Fatalf("ignored invalid ownership: %s", response.Body.String())
	}
}

func TestExitNodeReadFailureLeavesOtherForwardingUntouched(t *testing.T) {
	fixture := newExitNodeFixture()
	config := newTestConfig(t, fixture)
	if err := os.Remove(config.IPv6ForwardPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(config.IPv6ForwardPath, 0700); err != nil {
		t.Fatal(err)
	}
	response := performRequest(t, NewServer(config), http.MethodPost, "/api/exit-node", `{"enabled":true}`)
	if response.Code == http.StatusOK || fixture.advertised || forwardingEnabled(config.IPv4ForwardPath) {
		t.Fatalf("changed forwarding despite unreadable IPv6 state: %s", response.Body.String())
	}
}

func TestExitNodeNetworkLockHonorsContext(t *testing.T) {
	server := NewServer(newTestConfig(t, newExitNodeFixture()))
	unlock, err := server.lockNetworkMutation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	if release, err := NewServer(server.config).lockNetworkMutation(ctx); err == nil {
		release()
		t.Fatal("concurrent CGI acquired network lock")
	}
}

func TestExitNodeWarnsAboutManualFirewallAndSNAT(t *testing.T) {
	fixture := newExitNodeFixture()
	fixture.netfilter = "off"
	fixture.snat = false
	server := NewServer(newTestConfig(t, fixture))
	response := performRequest(t, server, http.MethodPost, "/api/exit-node", `{"enabled":true}`)
	if response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "SNAT") || !strings.Contains(response.Body.String(), "NAT") {
		t.Fatal("firewall limitations not surfaced")
	}
	if fixture.netfilter != "off" || fixture.snat {
		t.Fatal("unrelated firewall preferences overwritten")
	}
}

func TestExitNodeDisableCanRecoverWithoutInitialStatus(t *testing.T) {
	fixture := newExitNodeFixture()
	config := newTestConfig(t, fixture)
	server := NewServer(config)
	enableExitNode(t, server)
	fixture.invalidStatus, fixture.invalidGet = true, true
	response := performRequest(t, server, http.MethodPost, "/api/exit-node", `{"enabled":false}`)
	if response.Code != http.StatusOK || fixture.advertised || forwardingEnabled(config.IPv4ForwardPath) || forwardingEnabled(config.IPv6ForwardPath) {
		t.Fatalf("disable recovery failed: %s", response.Body.String())
	}
}

func TestExitNodeDisableWithdrawsAdvertisementWithCorruptJournal(t *testing.T) {
	fixture := newExitNodeFixture()
	config := newTestConfig(t, fixture)
	server := NewServer(config)
	enableExitNode(t, server)
	if err := os.WriteFile(server.journalPath(), []byte(`{"version":99}`), 0600); err != nil {
		t.Fatal(err)
	}
	response := performRequest(t, server, http.MethodPost, "/api/exit-node", `{"enabled":false}`)
	if response.Code != http.StatusOK || fixture.advertised || !forwardingEnabled(config.IPv4ForwardPath) {
		t.Fatalf("disable should withdraw exit while preserving unknown global settings: %s", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "恢复记录") {
		t.Fatal("missing cleanup limitation")
	}
}
