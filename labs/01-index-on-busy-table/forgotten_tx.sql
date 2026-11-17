-- A transaction someone opened and forgot: it read from orders and went quiet,
-- like a hung console command or a colleague's psql left open over lunch.
SET application_name = 'forgotten-tx';
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT count(*) AS orders_seen FROM orders WHERE id <= 1000;
\echo 'Транзакція відкрита й тримає snapshot (у стані бази: state = idle in transaction).'
\prompt 'Enter — завершити її: ' answer
ROLLBACK;
