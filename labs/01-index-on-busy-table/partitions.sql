-- Lab 1, step 4.3: a partitioned copy of orders, one partition a year, to build an index piece by piece.
-- Every fourth order is copied (~5 million rows), so each year holds history and only the current
-- one receives new orders.
\set ON_ERROR_STOP on
\timing on
SET maintenance_work_mem = '512MB';

DROP TABLE IF EXISTS orders_part;
DROP SEQUENCE IF EXISTS orders_part_id_seq;
CREATE SEQUENCE orders_part_id_seq;

CREATE TABLE orders_part (
    id          bigint        NOT NULL DEFAULT nextval('orders_part_id_seq'),
    customer_id bigint        NOT NULL,
    status      smallint      NOT NULL,
    amount      numeric(12,2) NOT NULL,
    created_at  timestamptz   NOT NULL,
    updated_at  timestamptz   NOT NULL,
    note        text
) PARTITION BY RANGE (created_at);

-- One partition per year, from the oldest order (orders.id = 1 is the oldest) to next year.
DO $$
DECLARE
    y int;
BEGIN
    FOR y IN
        SELECT generate_series(extract(year FROM (SELECT created_at FROM orders WHERE id = 1))::int,
                               extract(year FROM now())::int + 1)
    LOOP
        EXECUTE format('CREATE TABLE orders_part_%s PARTITION OF orders_part FOR VALUES FROM (%L) TO (%L)',
                       y, make_date(y, 1, 1), make_date(y + 1, 1, 1));
    END LOOP;
END $$;

\echo 'copying every fourth order...'
INSERT INTO orders_part (id, customer_id, status, amount, created_at, updated_at, note)
SELECT id, customer_id, status, amount, created_at, updated_at, note
FROM orders
WHERE id % 4 = 0;

ALTER TABLE orders_part ADD PRIMARY KEY (id, created_at);
SELECT setval('orders_part_id_seq', (SELECT max(id) FROM orders));
VACUUM (ANALYZE) orders_part;

SELECT c.relname AS partition,
       s.n_live_tup AS rows
FROM pg_inherits AS i
JOIN pg_class AS c ON c.oid = i.inhrelid
JOIN pg_stat_user_tables AS s ON s.relid = c.oid
WHERE i.inhparent = 'orders_part'::regclass
ORDER BY c.relname;
