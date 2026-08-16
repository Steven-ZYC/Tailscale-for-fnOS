package manager

import "strings"

type tailscaleStatus struct {
	Version        string                    `json:"Version"`
	BackendState   string                    `json:"BackendState"`
	HaveNodeKey    bool                      `json:"HaveNodeKey"`
	AuthURL        string                    `json:"AuthURL"`
	TailscaleIPs   []string                  `json:"TailscaleIPs"`
	Self           *tailscalePeer            `json:"Self"`
	Peer           map[string]*tailscalePeer `json:"Peer"`
	Health         []string                  `json:"Health"`
	CurrentTailnet *tailscaleCurrentTailnet  `json:"CurrentTailnet"`
}

type tailscaleCurrentTailnet struct {
	Name           string `json:"Name"`
	MagicDNSSuffix string `json:"MagicDNSSuffix"`
}

type tailscalePeer struct {
	ID             string   `json:"ID"`
	HostName       string   `json:"HostName"`
	DNSName        string   `json:"DNSName"`
	OS             string   `json:"OS"`
	TailscaleIPs   []string `json:"TailscaleIPs"`
	CurAddr        string   `json:"CurAddr"`
	Relay          string   `json:"Relay"`
	RxBytes        int64    `json:"RxBytes"`
	TxBytes        int64    `json:"TxBytes"`
	LastSeen       string   `json:"LastSeen"`
	Online         bool     `json:"Online"`
	Active         bool     `json:"Active"`
	ExitNode       bool     `json:"ExitNode"`
	ExitNodeOption bool     `json:"ExitNodeOption"`
}

type Device struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	DNSName        string   `json:"dns_name,omitempty"`
	OS             string   `json:"os,omitempty"`
	IPs            []string `json:"ips"`
	Online         bool     `json:"online"`
	Active         bool     `json:"active"`
	Connection     string   `json:"connection"`
	Relay          string   `json:"relay,omitempty"`
	LastSeen       string   `json:"last_seen,omitempty"`
	RxBytes        int64    `json:"rx_bytes"`
	TxBytes        int64    `json:"tx_bytes"`
	ExitNode       bool     `json:"exit_node"`
	ExitNodeOption bool     `json:"exit_node_option"`
	Self           bool     `json:"self"`
}

func deviceFromPeer(id string, peer *tailscalePeer, self, connected bool) Device {
	name := strings.TrimSpace(peer.HostName)
	if name == "" {
		name = strings.TrimSuffix(strings.TrimSpace(peer.DNSName), ".")
	}
	if name == "" {
		name = "未命名设备"
	}
	connection := "idle"
	if peer.CurAddr != "" {
		connection = "direct"
	} else if peer.Relay != "" {
		connection = "relay"
	} else if !peer.Online && !self {
		connection = "offline"
	}
	online := peer.Online
	if self {
		online = connected
	}
	if peer.ID != "" {
		id = peer.ID
	}
	return Device{
		ID:             id,
		Name:           name,
		DNSName:        strings.TrimSuffix(peer.DNSName, "."),
		OS:             peer.OS,
		IPs:            append([]string(nil), peer.TailscaleIPs...),
		Online:         online,
		Active:         peer.Active,
		Connection:     connection,
		Relay:          peer.Relay,
		LastSeen:       peer.LastSeen,
		RxBytes:        peer.RxBytes,
		TxBytes:        peer.TxBytes,
		ExitNode:       peer.ExitNode,
		ExitNodeOption: peer.ExitNodeOption,
		Self:           self,
	}
}
