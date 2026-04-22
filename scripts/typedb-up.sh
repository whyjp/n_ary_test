#!/usr/bin/env bash
# Start TypeDB 3.x via docker-compose. Run from WSL (bash).
# Usage: bash scripts/typedb-up.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/docker"

# Schema baked in for convenience (not required — we upload via HTTP).
cp "$ROOT_DIR/backend/schema.tql" ./schema.tql

docker compose build
docker compose up -d

echo "==> waiting for TypeDB HTTP API on :8000"
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:8000/v1/version" 2>/dev/null; then
    echo "==> TypeDB HTTP up"; exit 0
  fi
  if curl -sf -o /dev/null --max-time 2 "http://localhost:8000/" 2>/dev/null; then
    echo "==> TypeDB HTTP up (root responded)"; exit 0
  fi
  sleep 1
done
echo "!! TypeDB HTTP did not become ready in 60s"
echo "   logs: docker logs n_ary_typedb | tail -50"
exit 1
