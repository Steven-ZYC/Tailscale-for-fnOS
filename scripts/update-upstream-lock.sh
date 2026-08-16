#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

require_command curl
load_lock

version="${1:-}"
if [ -z "$version" ]; then
  version="$(${SCRIPT_DIR}/detect-upstream.sh --version-only)"
fi
validate_version "$version"

amd64_sha="$(curl --proto '=https' --tlsv1.2 --retry 3 --retry-all-errors \
  -fsSL "https://pkgs.tailscale.com/${TAILSCALE_TRACK}/tailscale_${version}_amd64.tgz.sha256")"
arm64_sha="$(curl --proto '=https' --tlsv1.2 --retry 3 --retry-all-errors \
  -fsSL "https://pkgs.tailscale.com/${TAILSCALE_TRACK}/tailscale_${version}_arm64.tgz.sha256")"

amd64_sha="$(printf '%s' "$amd64_sha" | tr -d '[:space:]')"
arm64_sha="$(printf '%s' "$arm64_sha" | tr -d '[:space:]')"
validate_sha256 "$amd64_sha"
validate_sha256 "$arm64_sha"

# Updating the bundled Tailscale binary must not silently promote an fnOS test
# package (for example fnos.0.1) to a stable fnos.1 release. A maintainer can
# still promote deliberately with PACKAGE_REVISION=1.
package_revision="${PACKAGE_REVISION:-${FNOS_PACKAGE_REVISION}}"
validate_package_revision "$package_revision"

temporary_lock="${LOCK_FILE}.tmp"
trap 'rm -f "$temporary_lock"' EXIT

{
  printf '%s\n' '# This file is updated by scripts/update-upstream-lock.sh.'
  printf 'TAILSCALE_TRACK=%s\n' "$TAILSCALE_TRACK"
  printf 'TAILSCALE_VERSION=%s\n' "$version"
  printf 'TAILSCALE_AMD64_SHA256=%s\n' "$amd64_sha"
  printf 'TAILSCALE_ARM64_SHA256=%s\n' "$arm64_sha"
  printf 'FNOS_PACKAGE_REVISION=%s\n' "$package_revision"
  printf 'FNPACK_VERSION=%s\n' "$FNPACK_VERSION"
  printf 'FNPACK_LINUX_AMD64_SHA256=%s\n' "$FNPACK_LINUX_AMD64_SHA256"
} > "$temporary_lock"

mv "$temporary_lock" "$LOCK_FILE"
trap - EXIT
printf 'updated %s to Tailscale %s\n' "$LOCK_FILE" "$version"
