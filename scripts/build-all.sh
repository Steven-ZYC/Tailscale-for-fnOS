#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

load_lock
output_dir="${1:-${PROJECT_ROOT}/dist}"
mkdir -p "$output_dir"
rm -f "${output_dir}"/*.fpk "${output_dir}/SHA256SUMS" "${output_dir}/provenance.json"

"${SCRIPT_DIR}/build-fpk.sh" x86 "$output_dir"
"${SCRIPT_DIR}/build-fpk.sh" arm "$output_dir"

"${SCRIPT_DIR}/verify-fpk.sh" \
  "${output_dir}/tailscale-fnos_${TAILSCALE_VERSION}-fnos.${FNOS_PACKAGE_REVISION}_x86.fpk" x86
"${SCRIPT_DIR}/verify-fpk.sh" \
  "${output_dir}/tailscale-fnos_${TAILSCALE_VERSION}-fnos.${FNOS_PACKAGE_REVISION}_arm.fpk" arm

(
  cd "$output_dir"
  checksum_tmp="$(mktemp "${output_dir}/.SHA256SUMS.XXXXXX")"
  trap 'rm -f "$checksum_tmp"' EXIT
  sha256sum ./*.fpk | sed 's#  \./#  #' | sort -k2 > "$checksum_tmp"
  mv "$checksum_tmp" SHA256SUMS
  trap - EXIT
  sha256sum -c SHA256SUMS
)

"${SCRIPT_DIR}/generate-provenance.sh" "$output_dir"
printf 'all packages are available in %s\n' "$output_dir"
