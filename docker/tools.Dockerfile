# psql, pgbench, watch and Python with psycopg for the lab scripts.
FROM postgres:17

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-psycopg procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /lab
