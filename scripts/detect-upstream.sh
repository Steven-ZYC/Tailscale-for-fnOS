#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

require_command curl
require_command grep
load_lock

mode="${1:---version-only}"

github_release_url="$(curl --proto '=https' --tlsv1.2 --retry 3 --retry-all-errors \
  -fsSL -o /dev/null -w '%{url_effective}' \
  https://github.com/tailscale/tailscale/releases/latest)"
github_version="${github_release_url##*/v}"
validate_version "$github_version"

package_version="$(curl --proto '=https' --tlsv1.2 --retry 3 --retry-all-errors \
  -fsSL "https://pkgs.tailscale.com/${TAILSCALE_TRACK}/" \
  | grep -oE 'tailscale_[0-9]+\.[0-9]+\.[0-9]+_amd64\.tgz' \
  | head -n 1 \
  | sed -E 's/^tailscale_([0-9]+\.[0-9]+\.[0-9]+)_amd64\.tgz$/\1/')"
validate_version "$package_version"

[ "$github_version" = "$package_version" ] || die \
  "GitHub latest (${github_version}) and official stable package (${package_version}) are not synchronized"

case "$mode" in
  --version-only)
    printf '%s\n' "$github_version"
    ;;
  --check-lock)
    if [ "$github_version" = "$TAILSCALE_VERSION" ]; then
      printf 'up-to-date: %s\n' "$TAILSCALE_VERSION"
      exit 0
    fi
    printf 'update-available: current=%s latest=%s\n' "$TAILSCALE_VERSION" "$github_version"
    exit 10
    ;;
  *)
    die "usage: $0 [--version-only|--check-lock]"
    ;;
esac
