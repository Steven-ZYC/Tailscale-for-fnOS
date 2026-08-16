#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

load_lock
require_command python3
require_command go

output_dir="${1:-${PROJECT_ROOT}/dist}"
[ -d "$output_dir" ] || die "output directory not found: $output_dir"

export PROVENANCE_OUTPUT_DIR="$output_dir"
export PROVENANCE_TAILSCALE_VERSION="$TAILSCALE_VERSION"
export PROVENANCE_TAILSCALE_TRACK="$TAILSCALE_TRACK"
export PROVENANCE_PACKAGE_REVISION="$FNOS_PACKAGE_REVISION"
export PROVENANCE_PACKAGE_VERSION="${TAILSCALE_VERSION}-fnos.${FNOS_PACKAGE_REVISION}"
export PROVENANCE_AMD64_SHA256="$TAILSCALE_AMD64_SHA256"
export PROVENANCE_ARM64_SHA256="$TAILSCALE_ARM64_SHA256"
export PROVENANCE_GITHUB_SHA="${GITHUB_SHA:-}"
export PROVENANCE_GITHUB_RUN_ID="${GITHUB_RUN_ID:-}"
export PROVENANCE_GO_VERSION="$(go env GOVERSION)"

python3 - <<'PY'
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

output_dir = Path(os.environ["PROVENANCE_OUTPUT_DIR"])
artifacts = []
for path in sorted(output_dir.glob("*.fpk")):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    artifacts.append({
        "name": path.name,
        "sha256": digest,
        "size": path.stat().st_size,
    })

document = {
    "schemaVersion": 2,
    "generatedAt": datetime.now(timezone.utc).isoformat(),
    "maintainer": "Steven Zhang Yancheng",
    "source": {
        "repository": "tailscale/tailscale",
        "track": os.environ["PROVENANCE_TAILSCALE_TRACK"],
        "version": os.environ["PROVENANCE_TAILSCALE_VERSION"],
        "packages": {
            "amd64": os.environ["PROVENANCE_AMD64_SHA256"],
            "arm64": os.environ["PROVENANCE_ARM64_SHA256"],
        },
    },
    "packageVersion": os.environ["PROVENANCE_PACKAGE_VERSION"],
    "fnosPackageRevision": os.environ["PROVENANCE_PACKAGE_REVISION"],
    "manager": {
        "implementation": "original Go CGI manager",
        "repository": "Steven-ZYC/Tailscale-for-fnOS",
        "goVersion": os.environ["PROVENANCE_GO_VERSION"],
    },
    "github": {
        "commit": os.environ["PROVENANCE_GITHUB_SHA"] or None,
        "runId": os.environ["PROVENANCE_GITHUB_RUN_ID"] or None,
    },
    "artifacts": artifacts,
}

(output_dir / "provenance.json").write_text(
    json.dumps(document, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
)
PY
