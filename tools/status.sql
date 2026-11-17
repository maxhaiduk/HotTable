-- What the database is doing right now. `make watch` runs this every second.
-- Nothing here opens `orders` itself, so the view keeps working while the table is locked.
\pset footer off
\pset null ''
SET lock_timeout = '500ms';
SET statement_timeout = '2s';

\echo '== Сесії, крім loadgen =='
SELECT pid,
       application_name AS app,
       state,
       wait_event_type || ':' || wait_event AS waits_on,
       pg_blocking_pids(pid) AS blocked_by,
       date_trunc('second', now() - xact_start) AS in_tx,
       left(regexp_replace(query, '\s+', ' ', 'g'), 70) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND backend_type = 'client backend'
  AND pid <> pg_backend_pid()
  AND application_name NOT LIKE 'loadgen%'
ORDER BY xact_start NULLS LAST;

\echo '== loadgen =='
SELECT application_name AS app,
       count(*) AS sessions,
       count(*) FILTER (WHERE wait_event_type = 'Lock') AS waiting_on_lock,
       round(extract(epoch FROM max(now() - query_start) FILTER (WHERE state = 'active')), 1)
           AS oldest_active_s,
       -- An active session with no wait event is running on the CPU.
       mode() WITHIN GROUP (ORDER BY coalesce(wait_event_type || ':' || wait_event, 'CPU'))
           FILTER (WHERE state = 'active') AS top_wait,
       (SELECT array_agg(DISTINCT b)
          FROM pg_stat_activity w, unnest(pg_blocking_pids(w.pid)) AS b
         WHERE w.application_name = a.application_name) AS blocked_by
FROM pg_stat_activity AS a
WHERE application_name LIKE 'loadgen%'
GROUP BY application_name
ORDER BY application_name;

\echo '== Блокування на orders (звичайні блокування loadgen не показано) =='
SELECT l.pid,
       a.application_name AS app,
       l.mode,
       l.granted
FROM pg_locks AS l
JOIN pg_stat_activity AS a USING (pid)
WHERE l.locktype = 'relation'
  AND l.relation = to_regclass('public.orders')
  AND (a.application_name NOT LIKE 'loadgen%' OR NOT l.granted)
ORDER BY l.granted DESC, l.pid;

\echo '== Побудова індексу (pg_stat_progress_create_index) =='
SELECT p.pid,
       p.command,
       p.phase,
       round(100.0 * p.blocks_done / nullif(p.blocks_total, 0), 1) AS blocks_pct,
       round(100.0 * p.tuples_done / nullif(p.tuples_total, 0), 1) AS tuples_pct,
       p.lockers_done || '/' || p.lockers_total AS lockers,
       nullif(p.current_locker_pid, 0) AS waits_for_pid,
       date_trunc('second', now() - a.query_start) AS running
FROM pg_stat_progress_create_index AS p
JOIN pg_stat_activity AS a USING (pid);

\echo '== Індекси orders (розмір оцінений з pg_class.relpages) =='
SELECT c.relname AS index,
       i.indisvalid AS valid,
       i.indisready AS ready,
       pg_size_pretty(c.relpages::bigint * current_setting('block_size')::bigint) AS size
FROM pg_index AS i
JOIN pg_class AS c ON c.oid = i.indexrelid
WHERE i.indrelid = to_regclass('public.orders')
ORDER BY c.relname;

\echo '== Репліка =='
SELECT application_name AS replica,
       state,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)) AS replay_behind,
       replay_lag
FROM pg_stat_replication;
