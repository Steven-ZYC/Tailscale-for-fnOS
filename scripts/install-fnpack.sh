#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

require_command curl
require_command sha256sum
load_lock
validate_sha256 "$FNPACK_LINUX_AMD64_SHA256"

tools_dir="${PROJECT_ROOT}/.tools"
fnpack_bin="${FNPACK_BIN:-${tools_dir}/fnpack}"

if [ -x "$fnpack_bin" ]; then
  printf 'using existing fnpack: %s\n' "$fnpack_bin"
  exit 0
fi

mkdir -p "$tools_dir"
temporary_bin="${fnpack_bin}.tmp"
trap 'rm -f "$temporary_bin"' EXIT

url="https://static2.fnnas.com/fnpack/fnpack-${FNPACK_VERSION}-linux-amd64"
printf 'downloading fnpack %s from fnOS...\n' "$FNPACK_VERSION"
curl --proto '=https' --tlsv1.2 --retry 3 --retry-all-errors -fsSL "$url" -o "$temporary_bin"
printf '%s  %s\n' "$FNPACK_LINUX_AMD64_SHA256" "$temporary_bin" | sha256sum -c -
chmod 0755 "$temporary_bin"
mv "$temporary_bin" "$fnpack_bin"
trap - EXIT

"$fnpack_bin" --help >/dev/null
printf 'installed fnpack: %s\n' "$fnpack_bin"
