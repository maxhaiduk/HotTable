-- An order changes status.
\set id random(1, :max_order_id)
\set status random(0, 4)
UPDATE orders SET status = :status, updated_at = now() WHERE id = :id;
