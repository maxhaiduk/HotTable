#!/bin/bash
# Lets the replica stream WAL from this server: a replication role, a slot that
# keeps WAL until the replica has received it, and a pg_hba line for replication.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replicator';
SELECT pg_create_physical_replication_slot('replica', true);
SQL

echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
