#!/usr/bin/env bash
# Convenience wrapper — stops both TypeDB and FalkorDB (compose tears both down).
set -euo pipefail
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/typedb-down.sh" "$@"
