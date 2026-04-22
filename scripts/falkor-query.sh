#!/usr/bin/env bash
# Ad-hoc Cypher read query against the n_ary_triplet graph in FalkorDB.
#
# Usage:
#   bash scripts/falkor-query.sh 'MATCH (p:Player {id:"P1"})-[r]->(n) RETURN type(r), labels(n), n.id LIMIT 10'
set -euo pipefail

Q="${1:-}"
if [[ -z "$Q" ]]; then
  echo "usage: $0 '<cypher-query>'"
  exit 1
fi

CONTAINER="${CONTAINER:-n_ary_falkordb}"
GRAPH="${FALKOR_GRAPH:-n_ary_triplet}"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "!! container ${CONTAINER} not running — start with: bash scripts/typedb-up.sh"
  exit 1
fi

docker exec -i "$CONTAINER" redis-cli GRAPH.QUERY "$GRAPH" "$Q"
