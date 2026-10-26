package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/http/cgi"
	"os"
	"time"

	"github.com/Steven-ZYC/Tailscale-for-fnOS/internal/manager"
)

var (
	packageVersion   = "dev"
	tailscaleVersion = "unknown"
)

func main() {
	command := "cgi"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	config := manager.DefaultConfig()
	config.PackageVersion = packageVersion
	config.TailscaleVersion = tailscaleVersion
	if stateDir := os.Getenv("TRIM_PKGVAR"); stateDir != "" {
		config.StateDir = stateDir
	}
	if tempDir := os.Getenv("TRIM_PKGTMP"); tempDir != "" {
		config.TempDir = tempDir
		config.SocketPath = tempDir + "/tailscaled.sock"
	}
	if command == "serve" {
		config.IconPath = "packaging/app/ui/images/icon_64.png"
		if binary := os.Getenv("TAILSCALE_FNOS_DEV_BINARY"); binary != "" {
			config.TailscaleBinary = binary
		}
	}
	server := manager.NewServer(config)

	switch command {
	case "cgi":
		if err := cgi.Serve(server); err != nil {
			log.Printf("CGI server failed: %v", err)
			os.Exit(1)
		}
	case "serve":
		address := "127.0.0.1:8385"
		if len(os.Args) > 2 {
			address = os.Args[2]
		}
		log.Printf("Tailscale for fnOS development server: http://%s", address)
		if err := http.ListenAndServe(address, server); err != nil {
			log.Fatal(err)
		}
	case "version":
		fmt.Printf("Tailscale for fnOS %s (Tailscale %s)\n", packageVersion, tailscaleVersion)
	case "restore-exit-node":
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		if err := server.RestoreExitNodeForwarding(ctx); err != nil {
			log.Printf("Unable to restore Exit Node forwarding: %v", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintln(os.Stderr, "usage: tailscale-fnos {cgi|serve [address]|version|restore-exit-node}")
		os.Exit(2)
	}
}
