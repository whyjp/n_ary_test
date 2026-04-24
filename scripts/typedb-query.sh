#!/usr/bin/env bash
# Ad-hoc read query against n_ary via TypeDB 3 HTTP API.
# Usage: bash scripts/typedb-query.sh 'match $e isa episode; select $e;'
set -euo pipefail

Q="${1:-}"
if [[ -z "$Q" ]]; then
  echo "usage: $0 '<typeql-match-query>'"
  exit 1
fi

HTTP_BASE="${TYPEDB_HTTP:-http://localhost:28000}"
DB="${TYPEDB_DATABASE:-n_ary}"
USER="${TYPEDB_USER:-admin}"
PASSWORD="${TYPEDB_PASSWORD:-password}"

TOKEN=$(curl -s -X POST "$HTTP_BASE/v1/signin" \
  -H "content-type: application/json" \
  -d "{\"username\":\"$USER\",\"password\":\"$PASSWORD\"}" | \
  python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null || true)

if [[ -z "$TOKEN" ]]; then
  # fallback parse
  TOKEN=$(curl -s -X POST "$HTTP_BASE/v1/signin" \
    -H "content-type: application/json" \
    -d "{\"username\":\"$USER\",\"password\":\"$PASSWORD\"}" | \
    sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
fi

curl -sS -X POST "$HTTP_BASE/v1/databases/$DB/query" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d "$(python3 -c "import json,sys;print(json.dumps({'query':sys.argv[1],'transactionType':'read','commit':False}))" "$Q" 2>/dev/null || \
       printf '{"query":%s,"transactionType":"read","commit":false}' "$(printf '%s' "$Q" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
  | (python3 -m json.tool 2>/dev/null || cat)
