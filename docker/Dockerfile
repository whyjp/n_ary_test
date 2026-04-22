# Thin wrapper around the official TypeDB 3.x image.
# Bakes the project schema into /opt/schema so scripts/typedb-load.sh
# can reference a stable in-container path.
FROM typedb/typedb:latest

COPY schema.tql /opt/schema/schema.tql

# TypeDB server listens on 1729 (gRPC).
EXPOSE 1729
