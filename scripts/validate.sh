#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

load_lock
validate_version "$TAILSCALE_VERSION"
validate_sha256 "$TAILSCALE_AMD64_SHA256"
validate_sha256 "$TAILSCALE_ARM64_SHA256"
validate_sha256 "$FNPACK_LINUX_AMD64_SHA256"
validate_package_revision "$FNOS_PACKAGE_REVISION"

required_files=(
  packaging/manifest.template
  packaging/config/privilege
  packaging/config/resource
  packaging/app/ui/config
  packaging/app/ui/index.cgi
  go.mod
  cmd/tailscale-fnos/main.go
  internal/manager/server.go
  internal/manager/web/index.html
  internal/manager/web/styles.css
  internal/manager/web/app.js
  packaging/ICON.PNG
  packaging/ICON_256.PNG
  packaging/app/ui/images/icon_64.png
  packaging/app/ui/images/icon_256.png
  packaging/cmd/main
  packaging/LICENSES/Tailscale-BSD-3-Clause.txt
  packaging/THIRD_PARTY_NOTICES.md
)

for relative_path in "${required_files[@]}"; do
  [ -f "${PROJECT_ROOT}/${relative_path}" ] || die "missing required file: ${relative_path}"
done

while IFS= read -r -d '' script_path; do
  bash -n "$script_path"
done < <(find "${PROJECT_ROOT}/scripts" "${PROJECT_ROOT}/packaging/cmd" \
  -type f \( -name '*.sh' -o -path '*/cmd/*' \) -print0)
bash -n "${PROJECT_ROOT}/packaging/app/ui/index.cgi"

require_command go
unformatted="$(gofmt -l "${PROJECT_ROOT}/cmd" "${PROJECT_ROOT}/internal")"
[ -z "$unformatted" ] || die "Go files require gofmt: ${unformatted}"
(
  cd "$PROJECT_ROOT"
  go test ./...
  go vet ./...
)

if command -v node >/dev/null 2>&1; then
  node --check "${PROJECT_ROOT}/internal/manager/web/app.js"
  node "${PROJECT_ROOT}/scripts/test-web-login.mjs"
fi

require_command python3
python3 - "${PROJECT_ROOT}" <<'PY'
import json
import struct
import sys
from pathlib import Path

root = Path(sys.argv[1])
for relative in (
    "packaging/config/privilege",
    "packaging/config/resource",
    "packaging/app/ui/config",
):
    with (root / relative).open("r", encoding="utf-8") as handle:
        json.load(handle)

expected_sizes = {
    "packaging/ICON.PNG": (64, 64),
    "packaging/ICON_256.PNG": (256, 256),
    "packaging/app/ui/images/icon_64.png": (64, 64),
    "packaging/app/ui/images/icon_256.png": (256, 256),
}
for relative, expected in expected_sizes.items():
    data = (root / relative).read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{relative}: not a PNG")
    width, height = struct.unpack(">II", data[16:24])
    if (width, height) != expected:
        raise SystemExit(f"{relative}: expected {expected}, found {(width, height)}")
PY

grep -q '^maintainer=Steven Zhang Yancheng$' "${PROJECT_ROOT}/packaging/manifest.template" || \
  die "manifest maintainer is incorrect"
grep -q '^maintainer_url=https://github.com/Steven-ZYC/Tailscale-for-fnOS$' \
  "${PROJECT_ROOT}/packaging/manifest.template" || \
  die "manifest maintainer URL is incorrect"
grep -q '^distributor_url=https://github.com/Steven-ZYC/Tailscale-for-fnOS$' \
  "${PROJECT_ROOT}/packaging/manifest.template" || \
  die "manifest distributor URL is incorrect"
grep -q '^source=thirdparty$' "${PROJECT_ROOT}/packaging/manifest.template" || \
  die "manifest must identify the package as third-party"

if command -v shellcheck >/dev/null 2>&1; then
  mapfile -d '' shell_files < <(find "${PROJECT_ROOT}/scripts" "${PROJECT_ROOT}/packaging/cmd" \
    -type f \( -name '*.sh' -o -path '*/cmd/*' \) -print0)
  shellcheck -x -P "${PROJECT_ROOT}/scripts" "${shell_files[@]}" \
    "${PROJECT_ROOT}/packaging/app/ui/index.cgi"
else
  printf '%s\n' 'warning: shellcheck is not installed; syntax checks still passed' >&2
fi

if git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$PROJECT_ROOT" diff --check
fi

printf 'validation passed for Tailscale %s (fnOS revision %s)\n' \
  "$TAILSCALE_VERSION" "$FNOS_PACKAGE_REVISION"
