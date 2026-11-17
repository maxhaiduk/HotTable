-- A new order in the partitioned copy: it lands in this year's partition, the only one written to.
\set customer_id random(1, :customers)
\set cents random(100, 100000)
INSERT INTO orders_part (customer_id, status, amount, created_at, updated_at)
VALUES (:customer_id, 0, :cents / 100.0, now(), now());
