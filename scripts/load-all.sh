#!/usr/bin/env bash
# One-shot: regenerate mock, reset both graph databases, and load each.
# Useful when re-seeding from scratch.
#
# Usage: bash scripts/load-all.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/backend"

echo "==> mockgen"
bun run src/cmd/mockgen.ts

echo "==> TypeDB load (reset)"
bun run src/cmd/load.ts --reset

echo "==> FalkorDB load (reset)"
bun run src/cmd/load-falkor.ts --reset

echo "==> done"
