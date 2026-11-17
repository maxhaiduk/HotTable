-- A transaction that changed one order and went quiet: until it ends, it holds
-- RowExclusiveLock on orders, as every writer does.
SET application_name = 'forgotten-write-tx';
BEGIN;
UPDATE orders SET updated_at = now() WHERE id = 1;
\echo 'Транзакція змінила замовлення 1 і тримає RowExclusiveLock на orders (у стані бази: idle in transaction).'
\prompt 'Enter — завершити її: ' answer
ROLLBACK;
