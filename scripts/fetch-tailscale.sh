#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

[ "$#" -eq 2 ] || die "usage: $0 <x86|arm> <package-stage-directory>"

requested_arch="$1"
stage_dir="$2"
map_architecture "$requested_arch"
load_lock
validate_version "$TAILSCALE_VERSION"

case "$UPSTREAM_ARCH" in
  amd64) expected_sha="$TAILSCALE_AMD64_SHA256" ;;
  arm64) expected_sha="$TAILSCALE_ARM64_SHA256" ;;
  *) die "internal architecture mapping error" ;;
esac
validate_sha256 "$expected_sha"

require_command curl
require_command sha256sum
require_command tar

cache_dir="${PROJECT_ROOT}/.cache/tailscale/${TAILSCALE_VERSION}"
archive="${cache_dir}/tailscale_${TAILSCALE_VERSION}_${UPSTREAM_ARCH}.tgz"
extract_dir="${cache_dir}/extract-${UPSTREAM_ARCH}"
url="https://pkgs.tailscale.com/${TAILSCALE_TRACK}/tailscale_${TAILSCALE_VERSION}_${UPSTREAM_ARCH}.tgz"
checksum_url="${url}.sha256"

mkdir -p "$cache_dir" "${stage_dir}/app/bin"

official_sha="$(curl --proto '=https' --tlsv1.2 --retry 3 --retry-all-errors -fsSL "$checksum_url" | tr -d '[:space:]')"
validate_sha256 "$official_sha"
[ "$official_sha" = "$expected_sha" ] || die \
  "official checksum changed for Tailscale ${TAILSCALE_VERSION} ${UPSTREAM_ARCH}"

if [ ! -f "$archive" ] || ! printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum -c - >/dev/null 2>&1; then
  temporary_archive="${archive}.tmp"
  trap 'rm -f "$temporary_archive"' EXIT
  printf 'downloading Tailscale %s for %s...\n' "$TAILSCALE_VERSION" "$UPSTREAM_ARCH"
  curl --proto '=https' --tlsv1.2 --retry 3 --retry-all-errors -fsSL "$url" -o "$temporary_archive"
  printf '%s  %s\n' "$expected_sha" "$temporary_archive" | sha256sum -c -
  mv "$temporary_archive" "$archive"
  trap - EXIT
fi

printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum -c -

rm -rf "$extract_dir"
mkdir -p "$extract_dir"
tar -xzf "$archive" -C "$extract_dir"

upstream_dir="${extract_dir}/tailscale_${TAILSCALE_VERSION}_${UPSTREAM_ARCH}"
[ -x "${upstream_dir}/tailscale" ] || die "tailscale binary missing from official archive"
[ -x "${upstream_dir}/tailscaled" ] || die "tailscaled binary missing from official archive"

install -m 0755 "${upstream_dir}/tailscale" "${stage_dir}/app/bin/tailscale"
install -m 0755 "${upstream_dir}/tailscaled" "${stage_dir}/app/bin/tailscaled"

cat > "${stage_dir}/app/BUILD-INFO.txt" <<EOF
Package: Tailscale for fnOS
Maintainer: Steven Zhang Yancheng
Tailscale-Version: ${TAILSCALE_VERSION}
Tailscale-Track: ${TAILSCALE_TRACK}
Upstream-Architecture: ${UPSTREAM_ARCH}
fnOS-Platform: ${FNOS_PLATFORM}
Upstream-URL: ${url}
Upstream-SHA256: ${expected_sha}
EOF
