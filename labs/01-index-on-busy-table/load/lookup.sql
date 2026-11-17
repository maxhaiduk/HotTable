-- The lab's query: a customer's latest orders.
\set customer_id random(1, :customers)
SELECT id, status, amount, created_at FROM orders
WHERE customer_id = :customer_id ORDER BY created_at DESC LIMIT 20;
