#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || die "usage: $0 <x86|arm> [output-directory]"

requested_arch="$1"
output_dir="${2:-${PROJECT_ROOT}/dist}"
map_architecture "$requested_arch"
load_lock
validate_version "$TAILSCALE_VERSION"
validate_package_revision "$FNOS_PACKAGE_REVISION"

package_version="${TAILSCALE_VERSION}-fnos.${FNOS_PACKAGE_REVISION}"
stage_parent="$(mktemp -d "${TMPDIR:-/tmp}/tailscale-fnos-${requested_arch}.XXXXXX")"
stage_dir="${stage_parent}/TailscaleFnos"
fnpack_bin="${FNPACK_BIN:-${PROJECT_ROOT}/.tools/fnpack}"
trap 'rm -rf "$stage_parent"' EXIT

[ -x "$fnpack_bin" ] || die "fnpack not found; run scripts/install-fnpack.sh first"
require_command go

mkdir -p "$stage_dir" "$output_dir"
cp -a "${PROJECT_ROOT}/packaging/." "$stage_dir/"

mkdir -p "${stage_dir}/app/bin"
(
  cd "$PROJECT_ROOT"
  CGO_ENABLED=0 GOOS=linux GOARCH="$UPSTREAM_ARCH" go build \
    -buildvcs=false \
    -trimpath \
    -ldflags "-s -w -X main.packageVersion=${package_version} -X main.tailscaleVersion=${TAILSCALE_VERSION}" \
    -o "${stage_dir}/app/bin/tailscale-fnos" \
    ./cmd/tailscale-fnos
)

# fnpack only carries application payload from app/. Keep redistribution
# notices inside that payload instead of relying on unregistered root files.
mkdir -p "${stage_dir}/app/LICENSES"
cp "${stage_dir}/LICENSES/Tailscale-BSD-3-Clause.txt" \
  "${stage_dir}/app/LICENSES/Tailscale-BSD-3-Clause.txt"
cp "${stage_dir}/THIRD_PARTY_NOTICES.md" \
  "${stage_dir}/app/THIRD_PARTY_NOTICES.md"

"${SCRIPT_DIR}/fetch-tailscale.sh" "$requested_arch" "$stage_dir"

sed \
  -e "s/@PACKAGE_VERSION@/${package_version}/g" \
  -e "s/@TAILSCALE_VERSION@/${TAILSCALE_VERSION}/g" \
  -e "s/@PACKAGE_REVISION@/${FNOS_PACKAGE_REVISION}/g" \
  -e "s/@FNOS_PLATFORM@/${FNOS_PLATFORM}/g" \
  "${stage_dir}/manifest.template" > "${stage_dir}/manifest"
rm -f "${stage_dir}/manifest.template"

# Normalize package modes before fnpack archives the staging tree. This is
# especially important when building from a Windows drive mounted by WSL.
find "${stage_dir}" -type f -exec chmod 0644 {} +
find "${stage_dir}/app/bin" -type f -exec chmod 0755 {} +
find "${stage_dir}/cmd" -type f -exec chmod 0755 {} +
chmod 0755 "${stage_dir}/app/ui/index.cgi" "${stage_dir}/app/bin/tailscale-fnos"
find "${stage_dir}" -type d -exec chmod 0755 {} +

rm -f "${stage_parent}"/*.fpk "${stage_dir}"/*.fpk
(
  cd "$stage_parent"
  "$fnpack_bin" build --directory "$stage_dir"
)

generated_fpk="$(find "$stage_parent" "$stage_dir" -maxdepth 1 -type f -name '*.fpk' -print | head -n 1)"
[ -n "$generated_fpk" ] || die "fnpack completed but no .fpk file was found"

output_file="${output_dir}/tailscale-fnos_${package_version}_${requested_arch}.fpk"
cp "$generated_fpk" "$output_file"
printf 'built %s\n' "$output_file"
