-- An order page.
\set id random(1, :max_order_id)
SELECT * FROM orders WHERE id = :id;
