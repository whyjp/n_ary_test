#!/usr/bin/env bash
# Run the cross-episode leakage comparison against TypeDB (n_ary) and
# FalkorDB (n_ary_triplet). Both databases must already be loaded.
#
# Usage: bash scripts/leakage.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/backend"
bun run src/cmd/leakage-test.ts
