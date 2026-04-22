#!/usr/bin/env bash
# Convenience wrapper — same as scripts/typedb-up.sh; the compose stack now
# brings up both TypeDB and FalkorDB, so the name "stack" is more accurate.
set -euo pipefail
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/typedb-up.sh" "$@"
