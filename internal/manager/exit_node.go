package manager

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Only values changed by this application are owned. The journal lives beside
// the persistent node state, so a reboot must not turn owned values into
// apparently pre-existing values. Paths never come from this file.
type forwardingJournal struct {
	Version int  `json:"version"`
	IPv4    bool `json:"ipv4_owned"`
	IPv6    bool `json:"ipv6_owned"`
}

func (s *Server) journalPath() string {
	return filepath.Join(s.config.StateDir, "exit-node-forwarding.json")
}

func (s *Server) readForwardingJournal() (forwardingJournal, error) {
	data, err := os.ReadFile(s.journalPath())
	if os.IsNotExist(err) {
		return forwardingJournal{Version: 1}, nil
	}
	if err != nil {
		return forwardingJournal{}, err
	}
	var journal forwardingJournal
	if err := json.Unmarshal(data, &journal); err != nil || journal.Version != 1 {
		return journal, errors.New("转发状态记录无效，请检查应用数据目录")
	}
	return journal, nil
}

func (s *Server) saveForwardingJournal(journal forwardingJournal) error {
	if err := os.MkdirAll(s.config.StateDir, 0700); err != nil {
		return err
	}
	data, err := json.Marshal(journal)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(s.config.StateDir, ".exit-node-forwarding-")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(name, s.journalPath())
}

func (s *Server) exitNodeAdvertised(ctx context.Context) (bool, error) {
	result, err := s.runner.Run(ctx, "get", "advertise-exit-node")
	if err != nil {
		return false, errors.New(commandMessage(result, err))
	}
	switch strings.TrimSpace(string(result.Stdout)) {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, errors.New("无法确认本机 Exit Node 广播状态")
	}
}

func readForwarding(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	value := strings.TrimSpace(string(data))
	if value != "0" && value != "1" {
		return "", fmt.Errorf("无效的 IP 转发状态 %q", value)
	}
	return value, nil
}

func writeForwarding(path, value string) error {
	// Do not create a substitute regular file if a kernel sysctl is absent.
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0)
	if err != nil {
		return err
	}
	_, writeErr := file.WriteString(value + "\n")
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	actual, err := readForwarding(path)
	if err != nil {
		return err
	}
	if actual != value {
		return errors.New("内核未应用 IP 转发设置")
	}
	return nil
}

func (s *Server) prepareForwarding(journal *forwardingJournal) ([]string, error) {
	warnings := []string{}
	for _, item := range []struct {
		path, name string
		owned      *bool
		optional   bool
	}{
		{s.config.IPv4ForwardPath, "IPv4", &journal.IPv4, false},
		{s.config.IPv6ForwardPath, "IPv6", &journal.IPv6, true},
	} {
		value, err := readForwarding(item.path)
		if item.optional && os.IsNotExist(err) {
			warnings = append(warnings, "系统未提供 IPv6 转发，仅启用 IPv4 出口能力")
			continue
		}
		if err != nil {
			return warnings, fmt.Errorf("无法读取 %s 转发：%w", item.name, err)
		}
		if value == "1" {
			continue
		}
		*item.owned = true
		// Persist ownership before changing the global kernel value.
		if err := s.saveForwardingJournal(*journal); err != nil {
			return warnings, fmt.Errorf("无法保存转发恢复记录：%w", err)
		}
		if err := writeForwarding(item.path, "1"); err != nil {
			return warnings, fmt.Errorf("无法启用 %s 转发：%w", item.name, err)
		}
	}
	return warnings, nil
}

func (s *Server) forwardingInUse(ctx context.Context) (bool, error) {
	for _, setting := range []string{"advertise-routes", "advertise-connector"} {
		result, err := s.runner.Run(ctx, "get", setting)
		if err != nil {
			return true, errors.New(commandMessage(result, err))
		}
		value := strings.TrimSpace(string(result.Stdout))
		if setting == "advertise-routes" && value != "" {
			return true, nil
		}
		if setting == "advertise-connector" {
			if value == "true" {
				return true, nil
			}
			if value != "false" {
				return true, errors.New("无法确认应用连接器状态")
			}
		}
	}
	// Bridges are commonly owned by Docker, VMs, and NAS network services.
	// Their global forwarding must not be disabled by this application's toggle.
	entries, err := os.ReadDir(s.config.NetworkClassPath)
	if err != nil {
		return true, err
	}
	for _, entry := range entries {
		if info, err := os.Stat(filepath.Join(s.config.NetworkClassPath, entry.Name(), "bridge")); err == nil && info.IsDir() {
			return true, nil
		}
	}
	return false, nil
}

func (s *Server) releaseForwarding(ctx context.Context, journal *forwardingJournal) []string {
	if !journal.IPv4 && !journal.IPv6 {
		return []string{}
	}
	used, err := s.forwardingInUse(ctx)
	if used {
		if err != nil {
			return []string{"出口广播已关闭；无法确认其他路由服务，暂时保留系统转发：" + err.Error()}
		}
		// The remaining routing service takes responsibility for global forwarding.
		journal.IPv4, journal.IPv6 = false, false
		if err := s.saveForwardingJournal(*journal); err != nil {
			return []string{"出口广播已关闭；保存转发恢复记录失败：" + err.Error()}
		}
		return []string{"出口广播已关闭；其他子网路由、容器或虚拟机服务仍需系统转发，已保留其设置"}
	}
	warnings := []string{}
	for _, item := range []struct {
		path, name string
		owned      *bool
	}{
		{s.config.IPv4ForwardPath, "IPv4", &journal.IPv4},
		{s.config.IPv6ForwardPath, "IPv6", &journal.IPv6},
	} {
		if !*item.owned {
			continue
		}
		if err := writeForwarding(item.path, "0"); err != nil && !os.IsNotExist(err) {
			warnings = append(warnings, "出口广播已关闭；恢复 "+item.name+" 转发失败："+err.Error())
			continue
		}
		*item.owned = false
	}
	if err := s.saveForwardingJournal(*journal); err != nil {
		warnings = append(warnings, "保存转发恢复记录失败："+err.Error())
	}
	return warnings
}

func (s *Server) setExitNode(ctx context.Context, enabled bool) ([]string, error) {
	unlock, err := s.lockNetworkMutation(ctx)
	if err != nil {
		return nil, err
	}
	defer unlock()
	if !enabled {
		result, err := s.runner.Run(ctx, "set", "--advertise-exit-node=false")
		if err != nil {
			return nil, errors.New(commandMessage(result, err))
		}
		advertised, err := s.exitNodeAdvertised(ctx)
		if err != nil {
			return nil, fmt.Errorf("关闭后无法确认本机状态：%w", err)
		}
		if advertised {
			return nil, errors.New("本机仍在广播 Exit Node，关闭未生效")
		}
		journal, err := s.readForwardingJournal()
		if err != nil {
			return []string{"出口广播已关闭；无法读取转发恢复记录，保留现有系统转发：" + err.Error()}, nil
		}
		return s.releaseForwarding(ctx, &journal), nil
	}
	before, err := s.readStatus(ctx)
	if err != nil {
		return nil, err
	}
	if !before.ExitNodeStateKnown {
		return nil, errors.New("无法读取本机 Exit Node 偏好，未修改设置")
	}
	journal, err := s.readForwardingJournal()
	if err != nil {
		return nil, err
	}
	if !before.LoggedIn {
		return nil, errors.New("请先登录 Tailscale，再启用本机 Exit Node")
	}
	previousJournal := journal
	previousV4, err := readForwarding(s.config.IPv4ForwardPath)
	if err != nil {
		return nil, fmt.Errorf("无法读取 IPv4 转发：%w", err)
	}
	previousV6, ipv6Err := readForwarding(s.config.IPv6ForwardPath)
	if ipv6Err != nil && !os.IsNotExist(ipv6Err) {
		return nil, fmt.Errorf("无法读取 IPv6 转发：%w", ipv6Err)
	}
	changedAdvertisement := false
	started := false
	rollback := func(cause error) ([]string, error) {
		// Request cancellation must not prevent best-effort rollback.
		rollbackCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		var failures []string
		if changedAdvertisement {
			result, err := s.runner.Run(rollbackCtx, "set", fmt.Sprintf("--advertise-exit-node=%t", before.ExitNodeAdvertised))
			if err != nil {
				failures = append(failures, commandMessage(result, err))
			} else if advertised, err := s.exitNodeAdvertised(rollbackCtx); err != nil || advertised != before.ExitNodeAdvertised {
				failures = append(failures, "无法确认出口广播已恢复")
			}
		}
		if started && !before.Connected {
			result, err := s.runner.Run(rollbackCtx, "down", "--accept-risk=lose-ssh")
			if err != nil {
				failures = append(failures, commandMessage(result, err))
			}
		}
		// Restore only settings touched during this attempt. Leave old ownership
		// intact so an earlier successful enable can still be disabled later.
		if len(failures) == 0 {
			for _, item := range []struct{ path, previous string }{
				{s.config.IPv4ForwardPath, previousV4}, {s.config.IPv6ForwardPath, previousV6},
			} {
				if item.previous != "0" {
					continue
				}
				current, err := readForwarding(item.path)
				if err != nil {
					failures = append(failures, err.Error())
					continue
				}
				if current == item.previous {
					continue
				}
				if err := writeForwarding(item.path, item.previous); err != nil {
					failures = append(failures, err.Error())
				}
			}
		}
		if len(failures) == 0 {
			if err := s.saveForwardingJournal(previousJournal); err != nil {
				failures = append(failures, err.Error())
			}
		}
		if len(failures) > 0 {
			return nil, fmt.Errorf("%w；部分恢复失败，请刷新状态并重试关闭：%s", cause, strings.Join(failures, "；"))
		}
		return nil, fmt.Errorf("%w；已恢复操作前设置", cause)
	}
	warnings, err := s.prepareForwarding(&journal)
	if err != nil {
		return rollback(err)
	}
	for _, setting := range []string{"netfilter-mode", "snat-subnet-routes"} {
		pref, err := s.runner.Run(ctx, "get", setting)
		if err != nil {
			continue
		}
		value := strings.TrimSpace(string(pref.Stdout))
		if setting == "netfilter-mode" && value != "on" {
			warnings = append(warnings, "当前防火墙模式为 "+value+"，请确认已配置出口转发及 NAT 规则")
		}
		if setting == "snat-subnet-routes" && value == "false" {
			warnings = append(warnings, "当前已关闭源地址转换（SNAT），出口流量可能无法正常访问互联网")
		}
	}
	changedAdvertisement = true // The CLI may change preferences before returning an error.
	result, err := s.runner.Run(ctx, "set", "--advertise-exit-node=true")
	if err != nil {
		return rollback(errors.New(commandMessage(result, err)))
	}
	if warning := strings.TrimSpace(string(result.Stderr)); warning != "" {
		warnings = append(warnings, warning)
	}
	// A true bare up preserves every configured preference. Even --timeout
	// makes up enforce its complete-settings rule; bound it with the context.
	upCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	started = true
	result, err = s.runner.Run(upCtx, "up")
	cancel()
	if err != nil {
		return rollback(errors.New("无法连接本机 Tailscale：" + commandMessage(result, err)))
	}
	after, err := s.readStatus(ctx)
	if err != nil {
		return rollback(fmt.Errorf("无法验证启用结果：%w", err))
	}
	if !after.ExitNodeEnabled {
		return rollback(errors.New("本机连接、出口广播或 IP 转发未全部生效"))
	}
	if after.ExitNodeApproval != "approved" {
		warnings = append(warnings, "本机 Exit Node 已启用；请在 Tailscale 管理控制台确认允许该设备作为出口节点")
	}
	return warnings, nil
}

// RestoreExitNodeForwarding is called by the fnOS lifecycle after the daemon's
// socket appears. Persistent Tailscale preferences remain authoritative.
func (s *Server) RestoreExitNodeForwarding(ctx context.Context) error {
	unlock, err := s.lockNetworkMutation(ctx)
	if err != nil {
		return err
	}
	defer unlock()
	advertised, err := s.exitNodeAdvertised(ctx)
	if err != nil {
		return err
	}
	journal, err := s.readForwardingJournal()
	if err != nil {
		return err
	}
	if !advertised {
		s.releaseForwarding(ctx, &journal)
		return nil
	}
	_, err = s.prepareForwarding(&journal)
	return err
}
