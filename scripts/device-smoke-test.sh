#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'usage: sudo %s /path/to/tailscale-fnos_*.fpk\n' "$0" >&2
  exit 2
fi

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'run this test as root on a disposable fnOS test device' >&2
  exit 2
fi

command -v appcenter-cli >/dev/null 2>&1 || {
  printf '%s\n' 'appcenter-cli was not found; this is not a supported fnOS test environment' >&2
  exit 1
}

fpk_path="$1"
[ -f "$fpk_path" ] || {
  printf 'FPK not found: %s\n' "$fpk_path" >&2
  exit 1
}

app_name="TailscaleFnos"
app_root="/var/apps/${app_name}"

printf '%s\n' '[1/6] Installing or upgrading the FPK...'
appcenter-cli install-fpk "$fpk_path"

printf '%s\n' '[2/6] Starting the application...'
appcenter-cli start "$app_name"

printf '%s\n' '[3/6] Checking lifecycle status and runtime files...'
"${app_root}/cmd/main" status
test -S "${app_root}/tmp/tailscaled.sock"
test -f "${app_root}/tmp/tailscaled.pid"
test -c /dev/net/tun
test -d /sys/class/net/tailscale0

printf '%s\n' '[4/6] Reading official binary and daemon status...'
"${app_root}/target/bin/tailscale-fnos" version
"${app_root}/target/bin/tailscale" --socket="${app_root}/tmp/tailscaled.sock" version --daemon
"${app_root}/target/bin/tailscale" --socket="${app_root}/tmp/tailscaled.sock" status --json || true

printf '%s\n' '[5/6] Verifying stop cleanup...'
appcenter-cli stop "$app_name"
if "${app_root}/cmd/main" status; then
  printf '%s\n' 'application still reports running after stop' >&2
  exit 1
else
  status_code=$?
  [ "$status_code" -eq 3 ] || exit "$status_code"
fi
test ! -S "${app_root}/tmp/tailscaled.sock"

printf '%s\n' '[6/6] Starting again to verify state reuse...'
appcenter-cli start "$app_name"
"${app_root}/cmd/main" status

printf '%s\n' 'Smoke test passed. Complete login and peer-connectivity checks from the fnOS desktop UI.'
