// Package load runs a lab's traffic against the primary: groups of workers, each worker
// on its own connection, each transaction drawn from the group's weighted scripts.
package load

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"db-problem-emulator/internal/lab"
)

// Status says whether the load runs and how the current or latest run went.
type Status struct {
	Running bool      `json:"running"`
	Since   time.Time `json:"since,omitzero"`
	Summary []Summary `json:"summary,omitempty"`
}

// Generator starts and stops the lab's traffic.
type Generator struct {
	lab    *lab.Lab
	dsn    string
	groups []*group

	mu      sync.Mutex
	running bool
	since   time.Time
	cancel  context.CancelFunc
	wg      sync.WaitGroup
	last    []Summary
}

type group struct {
	cfg         lab.Group
	scripts     []*Script
	totalWeight int
	stats       *stats
}

// New parses the lab's scripts; it does not connect yet.
func New(l *lab.Lab, dsn string) (*Generator, error) {
	g := &Generator{lab: l, dsn: dsn}
	for _, cfg := range l.Load {
		grp := &group{cfg: cfg, stats: newStats()}
		for _, ref := range cfg.Scripts {
			script, err := ParseScript(l.Path(ref.File), ref.Weight)
			if err != nil {
				return nil, err
			}
			grp.scripts = append(grp.scripts, script)
			grp.totalWeight += script.Weight
		}
		g.groups = append(g.groups, grp)
	}
	return g, nil
}

// Start computes the lab's variables and starts every worker. It does nothing if the load runs.
func (g *Generator) Start(ctx context.Context) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.running {
		return nil
	}
	vars, err := g.vars(ctx)
	if err != nil {
		return err
	}
	for _, grp := range g.groups {
		for _, script := range grp.scripts {
			if _, err := script.values(vars); err != nil {
				return err
			}
		}
		grp.stats = newStats()
	}
	runCtx, cancel := context.WithCancel(context.Background())
	for _, grp := range g.groups {
		for worker := range grp.cfg.Workers {
			g.wg.Add(1)
			go g.work(runCtx, grp, worker, vars)
		}
	}
	g.cancel = cancel
	g.running = true
	g.since = time.Now()
	g.last = nil
	return nil
}

// Stop cancels every query in flight, waits for the workers and returns the run's summary.
func (g *Generator) Stop() Status {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.running {
		return Status{Summary: g.last}
	}
	g.last = g.summaries()
	g.cancel()
	g.wg.Wait()
	g.running = false
	return Status{Since: g.since, Summary: g.last}
}

// Status reports the current run; while it runs, the summary covers it so far.
func (g *Generator) Status() Status {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.running {
		return Status{Summary: g.last}
	}
	return Status{Running: true, Since: g.since, Summary: g.summaries()}
}

// Windows returns the last second of every group and starts the next one; nil when stopped.
func (g *Generator) Windows() []Window {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.running {
		return nil
	}
	now := time.Now()
	windows := make([]Window, 0, len(g.groups))
	for _, grp := range g.groups {
		windows = append(windows, grp.stats.takeWindow(grp.cfg.Name, grp.cfg.StuckAfter, now))
	}
	return windows
}

func (g *Generator) summaries() []Summary {
	summaries := make([]Summary, 0, len(g.groups))
	for _, grp := range g.groups {
		summaries = append(summaries, grp.stats.summary(grp.cfg.Name))
	}
	return summaries
}

func (g *Generator) vars(ctx context.Context) (map[string]int64, error) {
	conn, err := pgx.Connect(ctx, g.dsn)
	if err != nil {
		return nil, err
	}
	defer conn.Close(context.Background())
	vars := make(map[string]int64, len(g.lab.Vars))
	for name, sql := range g.lab.Vars {
		var value *int64
		if err := conn.QueryRow(ctx, sql).Scan(&value); err != nil {
			return nil, fmt.Errorf("variable %s: %w (are the lab's tables seeded? make seed)", name, err)
		}
		if value == nil {
			return nil, fmt.Errorf("variable %s is NULL: the lab's tables are empty (make seed)", name)
		}
		vars[name] = *value
	}
	return vars, nil
}

func (g *Generator) work(ctx context.Context, grp *group, worker int, vars map[string]int64) {
	defer g.wg.Done()
	interval := grp.cfg.Interval()
	// Spread the workers over the first interval so they do not fire in step.
	if !sleep(ctx, rand.N(interval)) {
		return
	}
	var conn *pgx.Conn
	defer func() {
		if conn != nil {
			conn.Close(context.Background())
		}
	}()
	for ctx.Err() == nil {
		if conn == nil || conn.IsClosed() {
			if conn = g.connect(ctx, "loadgen-"+grp.cfg.Name); conn == nil {
				return
			}
		}
		cycle := time.Now()
		script := grp.pick()
		args, err := script.values(vars)
		if err != nil {
			return // checked in Start, so it cannot happen
		}
		started := grp.stats.start(worker)
		_, err = conn.Exec(ctx, script.sql, args...)
		if ctx.Err() != nil {
			grp.stats.abandon(worker)
			return
		}
		grp.stats.finish(worker, started, err)
		if !sleep(ctx, interval-time.Since(cycle)) {
			return
		}
	}
}

func (grp *group) pick() *Script {
	n := rand.IntN(grp.totalWeight)
	for _, script := range grp.scripts {
		if n < script.Weight {
			return script
		}
		n -= script.Weight
	}
	return grp.scripts[len(grp.scripts)-1]
}

// connect retries until it gets a connection or the load stops; nil means it stopped.
func (g *Generator) connect(ctx context.Context, app string) *pgx.Conn {
	cfg, err := pgx.ParseConfig(g.dsn)
	if err != nil {
		return nil
	}
	cfg.RuntimeParams["application_name"] = app
	for {
		conn, err := pgx.ConnectConfig(ctx, cfg)
		if err == nil {
			return conn
		}
		if errors.Is(err, context.Canceled) || !sleep(ctx, time.Second) {
			return nil
		}
	}
}

// sleep waits for d or until ctx ends; false means ctx ended.
func sleep(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
