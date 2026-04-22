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
typedb_up=0
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "http://localhost:8000/v1/version" 2>/dev/null \
    || curl -sf -o /dev/null --max-time 2 "http://localhost:8000/" 2>/dev/null; then
    typedb_up=1; echo "==> TypeDB HTTP up"; break
  fi
  sleep 1
done
if [[ $typedb_up -eq 0 ]]; then
  echo "!! TypeDB HTTP did not become ready in 60s — docker logs n_ary_typedb"
  exit 1
fi

echo "==> waiting for FalkorDB on :6379"
for i in $(seq 1 30); do
  if docker exec n_ary_falkordb redis-cli ping 2>/dev/null | grep -q PONG; then
    echo "==> FalkorDB up"; exit 0
  fi
  sleep 1
done
echo "!! FalkorDB did not respond in 30s — docker logs n_ary_falkordb"
exit 1
