#!/bin/bash
# Clones the primary on first start, then runs as a read-only streaming standby.
set -euo pipefail

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    until pg_isready -h primary -q; do sleep 1; done
    pg_basebackup -h primary -D "$PGDATA" --slot=replica \
        --write-recovery-conf --wal-method=stream --checkpoint=fast --progress
    chmod 0700 "$PGDATA"
fi

exec postgres \
    -c cluster_name=replica \
    -c shared_buffers=512MB \
    -c max_wal_size=4GB \
    -c max_parallel_workers_per_gather=0
