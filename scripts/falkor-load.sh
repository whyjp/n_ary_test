#!/usr/bin/env bash
# Load the triplet baseline into FalkorDB.
# Requires: scripts/typedb-up.sh has launched the compose stack (FalkorDB is
# part of it), and mock data has been generated (backend/out/episodes.json).
#
# Usage:
#   bash scripts/falkor-load.sh            # additive load
#   bash scripts/falkor-load.sh --reset    # drop the graph first
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "!! bun is required in PATH"; exit 1
fi

cd "$ROOT_DIR/backend"
bun run src/cmd/load-falkor.ts "$@"
