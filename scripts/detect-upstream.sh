#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

require_command curl
require_command python3
load_lock

mode="${1:---version-only}"

# GitHub's latest release may only update containers or another platform.
# Track the official Linux static packages that are actually bundled here.
package_index="$(curl --proto '=https' --tlsv1.2 --retry 3 --retry-all-errors \
  -fsSL "https://pkgs.tailscale.com/${TAILSCALE_TRACK}/?mode=json&os=linux")"
package_version="$(printf '%s' "$package_index" | python3 -c '
import json
import sys

try:
    metadata = json.load(sys.stdin)
    version = metadata.get("TarballsVersion")
    tarballs = metadata.get("Tarballs")
    if not isinstance(version, str) or not version or not isinstance(tarballs, dict):
        raise ValueError("missing TarballsVersion or Tarballs")
    for arch in ("amd64", "arm64"):
        expected = f"tailscale_{version}_{arch}.tgz"
        if tarballs.get(arch) != expected:
            raise ValueError(f"{arch} static package does not match {version}")
except (ValueError, AttributeError) as error:
    print(f"error: invalid official Linux package index: {error}", file=sys.stderr)
    sys.exit(1)

print(version)
')"
validate_version "$package_version"

case "$mode" in
  --version-only)
    printf '%s\n' "$package_version"
    ;;
  --check-lock)
    if [ "$package_version" = "$TAILSCALE_VERSION" ]; then
      printf 'up-to-date: %s\n' "$TAILSCALE_VERSION"
      exit 0
    fi
    printf 'update-available: current=%s latest=%s\n' "$TAILSCALE_VERSION" "$package_version"
    exit 10
    ;;
  *)
    die "usage: $0 [--version-only|--check-lock]"
    ;;
esac
