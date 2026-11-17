// Package observe takes snapshots of what the database is doing: the same queries as
// tools/status.sql, returned as data for the UI. None of them opens the lab's table itself,
// so snapshots keep coming while the table is locked.
package observe

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// State is one snapshot of the primary.
type State struct {
	Sessions []Session `json:"sessions"`
	Loadgen  []Loadgen `json:"loadgen"`
	Locks    []Lock    `json:"locks"`
	Progress []Build   `json:"progress"`
	Indexes  []Index   `json:"indexes"`
	Replicas []Replica `json:"replicas"`
	// WALRate is bytes of WAL written per second since the previous snapshot.
	WALRate float64 `json:"wal_rate"`
	Error   string  `json:"error,omitempty"`
}

// Session is a client session other than the load generator and labd itself.
type Session struct {
	PID       int32    `db:"pid" json:"pid"`
	App       string   `db:"app" json:"app"`
	State     string   `db:"state" json:"state"`
	WaitsOn   string   `db:"waits_on" json:"waits_on"`
	BlockedBy []int32  `db:"blocked_by" json:"blocked_by"`
	InTx      *float64 `db:"in_tx" json:"in_tx"`
	Query     string   `db:"query" json:"query"`
}

// Loadgen sums up the load generator's sessions of one group.
type Loadgen struct {
	App           string  `db:"app" json:"app"`
	Sessions      int32   `db:"sessions" json:"sessions"`
	WaitingOnLock int32   `db:"waiting_on_lock" json:"waiting_on_lock"`
	TopWait       string  `db:"top_wait" json:"top_wait"`
	BlockedBy     []int32 `db:"blocked_by" json:"blocked_by"`
}

// Lock is a lock on the lab's table, except the load generator's ordinary granted ones.
type Lock struct {
	PID     int32  `db:"pid" json:"pid"`
	App     string `db:"app" json:"app"`
	Mode    string `db:"mode" json:"mode"`
	Granted bool   `db:"granted" json:"granted"`
}

// Build is an index build in progress.
type Build struct {
	PID          int32   `db:"pid" json:"pid"`
	Command      string  `db:"command" json:"command"`
	Phase        string  `db:"phase" json:"phase"`
	BlocksTotal  int64   `db:"blocks_total" json:"blocks_total"`
	BlocksDone   int64   `db:"blocks_done" json:"blocks_done"`
	TuplesTotal  int64   `db:"tuples_total" json:"tuples_total"`
	TuplesDone   int64   `db:"tuples_done" json:"tuples_done"`
	LockersTotal int64   `db:"lockers_total" json:"lockers_total"`
	LockersDone  int64   `db:"lockers_done" json:"lockers_done"`
	WaitsForPID  *int64  `db:"waits_for_pid" json:"waits_for_pid"`
	Running      float64 `db:"running" json:"running"`
}

// Index is an index of the lab's table.
type Index struct {
	Name       string `db:"name" json:"name"`
	Valid      bool   `db:"valid" json:"valid"`
	Ready      bool   `db:"ready" json:"ready"`
	Bytes      int64  `db:"bytes" json:"bytes"`
	Definition string `db:"definition" json:"definition"`
}

// Replica is a standby streaming from the primary.
type Replica struct {
	Name        string  `db:"name" json:"name"`
	State       string  `db:"state" json:"state"`
	BehindBytes int64   `db:"behind_bytes" json:"behind_bytes"`
	LagSeconds  float64 `db:"lag_seconds" json:"lag_seconds"`
}

const sessionsSQL = `
SELECT pid,
       coalesce(application_name, '') AS app,
       coalesce(state, '') AS state,
       coalesce(wait_event_type || ':' || wait_event, '') AS waits_on,
       pg_blocking_pids(pid) AS blocked_by,
       extract(epoch FROM now() - xact_start)::float8 AS in_tx,
       left(regexp_replace(coalesce(query, ''), '\s+', ' ', 'g'), 300) AS query
FROM pg_stat_activity
WHERE datname = current_database()
  AND backend_type = 'client backend'
  AND pid <> pg_backend_pid()
  AND application_name NOT LIKE 'loadgen%'
  AND application_name NOT LIKE 'labd%'
ORDER BY xact_start NULLS LAST`

const loadgenSQL = `
SELECT application_name AS app,
       count(*)::int AS sessions,
       (count(*) FILTER (WHERE wait_event_type = 'Lock'))::int AS waiting_on_lock,
       coalesce(mode() WITHIN GROUP (ORDER BY coalesce(wait_event_type || ':' || wait_event, 'CPU'))
                FILTER (WHERE state = 'active'), '') AS top_wait,
       coalesce((SELECT array_agg(DISTINCT b)
                   FROM pg_stat_activity AS w, unnest(pg_blocking_pids(w.pid)) AS b
                  WHERE w.application_name = a.application_name), '{}') AS blocked_by
FROM pg_stat_activity AS a
WHERE application_name LIKE 'loadgen%'
GROUP BY application_name
ORDER BY application_name`

const locksSQL = `
SELECT l.pid, coalesce(a.application_name, '') AS app, l.mode, l.granted
FROM pg_locks AS l
JOIN pg_stat_activity AS a USING (pid)
WHERE l.locktype = 'relation'
  AND l.relation = to_regclass($1)
  AND (a.application_name NOT LIKE 'loadgen%' OR NOT l.granted)
ORDER BY l.granted DESC, l.pid`

const progressSQL = `
SELECT p.pid, p.command, p.phase,
       p.blocks_total, p.blocks_done, p.tuples_total, p.tuples_done,
       p.lockers_total, p.lockers_done,
       nullif(p.current_locker_pid, 0) AS waits_for_pid,
       extract(epoch FROM now() - a.query_start)::float8 AS running
FROM pg_stat_progress_create_index AS p
JOIN pg_stat_activity AS a USING (pid)`

const indexesSQL = `
SELECT c.relname AS name,
       i.indisvalid AS valid,
       i.indisready AS ready,
       c.relpages::bigint * current_setting('block_size')::bigint AS bytes,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index AS i
JOIN pg_class AS c ON c.oid = i.indexrelid
WHERE i.indrelid = to_regclass($1)
ORDER BY c.relname`

const replicasSQL = `
SELECT coalesce(application_name, '') AS name,
       coalesce(state, '') AS state,
       coalesce(pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn), 0)::bigint AS behind_bytes,
       coalesce(extract(epoch FROM replay_lag), 0)::float8 AS lag_seconds
FROM pg_stat_replication`

// Observer keeps one connection to the primary and takes snapshots through it.
type Observer struct {
	dsn   string
	table string
	conn  *pgx.Conn

	walBytes float64
	walAt    time.Time
}

// New prepares an observer of table; it connects on the first snapshot.
func New(dsn, table string) *Observer {
	return &Observer{dsn: dsn, table: table}
}

// Snapshot returns the current state; a failure is reported in State.Error.
func (o *Observer) Snapshot(ctx context.Context) State {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := o.ensureConn(ctx); err != nil {
		return State{Error: err.Error()}
	}
	var s State
	var err error
	if s.Sessions, err = collect[Session](ctx, o.conn, sessionsSQL); err != nil {
		return o.fail(err)
	}
	if s.Loadgen, err = collect[Loadgen](ctx, o.conn, loadgenSQL); err != nil {
		return o.fail(err)
	}
	if s.Locks, err = collect[Lock](ctx, o.conn, locksSQL, o.table); err != nil {
		return o.fail(err)
	}
	if s.Progress, err = collect[Build](ctx, o.conn, progressSQL); err != nil {
		return o.fail(err)
	}
	if s.Indexes, err = collect[Index](ctx, o.conn, indexesSQL, o.table); err != nil {
		return o.fail(err)
	}
	if s.Replicas, err = collect[Replica](ctx, o.conn, replicasSQL); err != nil {
		return o.fail(err)
	}
	var wal float64
	if err := o.conn.QueryRow(ctx, `SELECT (pg_current_wal_lsn() - '0/0'::pg_lsn)::float8`).Scan(&wal); err != nil {
		return o.fail(err)
	}
	now := time.Now()
	if !o.walAt.IsZero() {
		s.WALRate = (wal - o.walBytes) / now.Sub(o.walAt).Seconds()
	}
	o.walBytes, o.walAt = wal, now
	return s
}

func (o *Observer) ensureConn(ctx context.Context) error {
	if o.conn != nil && !o.conn.IsClosed() {
		return nil
	}
	cfg, err := pgx.ParseConfig(o.dsn)
	if err != nil {
		return err
	}
	cfg.RuntimeParams["application_name"] = "labd-observe"
	cfg.RuntimeParams["lock_timeout"] = "500ms"
	cfg.RuntimeParams["statement_timeout"] = "2s"
	o.conn, err = pgx.ConnectConfig(ctx, cfg)
	return err
}

func (o *Observer) fail(err error) State {
	if o.conn != nil {
		o.conn.Close(context.Background())
		o.conn = nil
	}
	return State{Error: err.Error()}
}

func collect[T any](ctx context.Context, conn *pgx.Conn, sql string, args ...any) ([]T, error) {
	rows, err := conn.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByName[T])
	if items == nil {
		items = []T{}
	}
	return items, err
}
