#!/bin/sh

# fnOS authenticates the NAS administrator session before executing this CGI.
# The compiled manager exposes only a fixed, validated API and never evaluates
# request values as shell commands.
MANAGER_BIN="/var/apps/TailscaleFnos/target/bin/tailscale-fnos"

if [ ! -x "$MANAGER_BIN" ]; then
  printf 'Status: 500 Internal Server Error\r\n'
  printf 'Content-Type: text/plain; charset=utf-8\r\n\r\n'
  printf 'Tailscale for fnOS manager is missing. Reinstall the application.\n'
  exit 0
fi

exec "$MANAGER_BIN" cgi
