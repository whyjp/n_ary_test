# Thin wrapper around the official TypeDB 3.x image.
# Bakes the project schema into /opt/schema so scripts/typedb-load.sh
# can reference a stable in-container path.
FROM typedb/typedb:latest

COPY backend/schema.tql /opt/schema/schema.tql

# TypeDB server listens on 1729 (gRPC) inside the container.
# docker-compose.yml remaps host ports to 21729 (gRPC) / 28000 (HTTP) to avoid clashes.
EXPOSE 1729
