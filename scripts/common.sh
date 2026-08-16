#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCK_FILE="${UPSTREAM_LOCK_FILE:-${PROJECT_ROOT}/upstream.lock}"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

load_lock() {
  [ -f "$LOCK_FILE" ] || die "lock file not found: $LOCK_FILE"

  # upstream.lock is repository-controlled shell assignment syntax.
  # shellcheck disable=SC1090
  source "$LOCK_FILE"

  : "${TAILSCALE_TRACK:?missing TAILSCALE_TRACK}"
  : "${TAILSCALE_VERSION:?missing TAILSCALE_VERSION}"
  : "${TAILSCALE_AMD64_SHA256:?missing TAILSCALE_AMD64_SHA256}"
  : "${TAILSCALE_ARM64_SHA256:?missing TAILSCALE_ARM64_SHA256}"
  : "${FNOS_PACKAGE_REVISION:?missing FNOS_PACKAGE_REVISION}"
  : "${FNPACK_VERSION:?missing FNPACK_VERSION}"
  : "${FNPACK_LINUX_AMD64_SHA256:?missing FNPACK_LINUX_AMD64_SHA256}"
}

validate_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid stable version: $1"
}

validate_package_revision() {
  [[ "$1" =~ ^(0\.[1-9][0-9]*|[1-9][0-9]*)$ ]] || \
    die "invalid fnOS package revision: $1"
}

validate_sha256() {
  [[ "$1" =~ ^[0-9a-f]{64}$ ]] || die "invalid SHA-256: $1"
}

map_architecture() {
  case "$1" in
    x86)
      export FNOS_PLATFORM=x86
      export UPSTREAM_ARCH=amd64
      ;;
    arm)
      export FNOS_PLATFORM=arm
      export UPSTREAM_ARCH=arm64
      ;;
    *)
      die "unsupported architecture '$1'; expected x86 or arm"
      ;;
  esac
}
