#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

[ "$#" -eq 2 ] || die "usage: $0 <package.fpk> <x86|arm>"

package_file="$1"
requested_arch="$2"
map_architecture "$requested_arch"
load_lock

[ -f "$package_file" ] || die "package not found: $package_file"

outer_listing="$(tar -tzf "$package_file")"
for required_path in manifest app.tgz config/privilege config/resource cmd/main; do
  printf '%s\n' "$outer_listing" | grep -Fxq "$required_path" || \
    die "missing outer package entry: $required_path"
done

manifest="$(tar -xOzf "$package_file" manifest)"
printf '%s\n' "$manifest" | grep -Eq \
  "^platform[[:space:]]*=[[:space:]]*${FNOS_PLATFORM}[[:space:]]*$" || \
  die "manifest platform does not match ${FNOS_PLATFORM}"
printf '%s\n' "$manifest" | grep -Eq \
  '^maintainer[[:space:]]*=[[:space:]]*Steven Zhang Yancheng[[:space:]]*$' || \
  die "manifest maintainer is incorrect"
printf '%s\n' "$manifest" | grep -Eq \
  '^maintainer_url[[:space:]]*=[[:space:]]*https://github.com/Steven-ZYC/Tailscale-for-fnOS[[:space:]]*$' || \
  die "manifest maintainer URL is incorrect"
printf '%s\n' "$manifest" | grep -Eq \
  '^distributor_url[[:space:]]*=[[:space:]]*https://github.com/Steven-ZYC/Tailscale-for-fnOS[[:space:]]*$' || \
  die "manifest distributor URL is incorrect"

payload_listing="$(tar -xOzf "$package_file" app.tgz | tar -tzf -)"
for required_path in \
  bin/tailscale \
  bin/tailscaled \
  bin/tailscale-fnos \
  ui/index.cgi \
  ui/images/icon_64.png \
  ui/images/icon_256.png \
  BUILD-INFO.txt \
  LICENSES/Tailscale-BSD-3-Clause.txt \
  THIRD_PARTY_NOTICES.md; do
  printf '%s\n' "$payload_listing" | grep -Fxq "$required_path" || \
    die "missing application payload entry: $required_path"
done

index_cgi="$(tar -xOzf "$package_file" app.tgz | tar -xOzf - ui/index.cgi)"
printf '%s\n' "$index_cgi" | grep -Fq 'tailscale-fnos' || \
  die "CGI entry does not invoke the original manager"
if printf '%s\n' "$index_cgi" | grep -Fq 'web --cgi'; then
  die "CGI entry still invokes the upstream Tailscale web UI"
fi

printf 'verified %s (%s)\n' "$package_file" "$requested_arch"
