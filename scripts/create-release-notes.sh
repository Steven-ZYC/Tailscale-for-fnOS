#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

load_lock
output_file="${1:-${PROJECT_ROOT}/dist/RELEASE_NOTES.md}"
package_version="${TAILSCALE_VERSION}-fnos.${FNOS_PACKAGE_REVISION}"

cat > "$output_file" <<EOF
# Tailscale for fnOS ${package_version}

Community-maintained native fnOS packages containing the official Tailscale
${TAILSCALE_VERSION} stable Linux binaries and an original fnOS management
interface.

## Version and architectures

- fnOS community integration: \`fnos.${FNOS_PACKAGE_REVISION}\` (test release)
- Complete FPK version: \`${package_version}\`
- GitHub Release tag: \`v${package_version}\`
- \`x86\`: for x86_64/amd64 fnOS systems
- \`arm\`: for arm64/aarch64 fnOS systems

No 32-bit ARM package is currently produced. \`upstream.lock\` records the
Tailscale version, amd64 and arm64 SHA-256 digests, fnOS package revision, and
the pinned \`fnpack\` tool digest used for this release.

## fnos.${FNOS_PACKAGE_REVISION} features

- Original Chinese dashboard; does not use the upstream CGI web interface
- Connect/disconnect, account logout, and automatic browser or Auth Key login
- Overview, Devices, and Settings pages with responsive navigation
- OS-aware original SVG device icons, search, online filtering, and pagination
- Stable 70-160% font and 50-160% interface-zoom controls with editable values
- Tailnet device list and online-device count
- On-demand DERP latency measurement
- Local hostname and Exit Node advertisement controls
- GitHub Release version check with update notification

This is a test build. Complete the clean-VM acceptance checklist before making
the GitHub Release public or submitting it to the fnOS application center.

Install through fnOS App Center's manual-install function for testing. Public
distribution should use the fnOS application-center review process.

## Integrity

Verify downloads with \`SHA256SUMS\`. \`provenance.json\` records the official
upstream package digests and this build's artifact digests.

Upstream release: https://github.com/tailscale/tailscale/releases/tag/v${TAILSCALE_VERSION}

Official package source: https://pkgs.tailscale.com/${TAILSCALE_TRACK}/

## Disclaimer

Tailscale is a registered trademark of Tailscale Inc. This package is maintained
by Steven Zhang Yancheng and is not endorsed by Tailscale Inc. or the fnOS vendor.
EOF
