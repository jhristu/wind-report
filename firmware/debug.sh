#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WAIT_SECONDS=120 DEBUG_AWAKE=180 "$ROOT/firmware/flash.sh"
"$ROOT/firmware/monitor.sh"
