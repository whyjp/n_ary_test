#!/usr/bin/env bash
# Stop the TypeDB container (data volume preserved).
# Usage: bash scripts/typedb-down.sh [--wipe]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/docker"

if [[ "${1:-}" == "--wipe" ]]; then
  docker compose down -v
else
  docker compose down
fi
