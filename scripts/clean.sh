#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

case "$PROJECT_ROOT" in
  /|/home|/mnt|/mnt/*/|"")
    printf 'refusing to clean unsafe project root: %s\n' "$PROJECT_ROOT" >&2
    exit 1
    ;;
esac

rm -rf "${PROJECT_ROOT}/build" "${PROJECT_ROOT}/dist" "${PROJECT_ROOT}/.tools" "${PROJECT_ROOT}/.cache"
printf 'removed generated build directories under %s\n' "$PROJECT_ROOT"
