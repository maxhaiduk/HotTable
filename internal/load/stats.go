package load

import (
	"slices"
	"strings"
	"sync"
	"time"
)

// Window is one second of one group's traffic. Durations are in seconds.
type Window struct {
	Group  string  `json:"group"`
	Count  int     `json:"count"`
	Errors int     `json:"errors"`
	P50    float64 `json:"p50"`
	P99    float64 `json:"p99"`
	Max    float64 `json:"max"`
	// Stuck is how long the oldest unfinished query has been running.
	Stuck      float64 `json:"stuck"`
	StuckAfter float64 `json:"stuck_after"`
	// Last is the latency of the latest finished query, whenever it finished.
	Last      float64 `json:"last"`
	LastError string  `json:"last_error,omitempty"`
}

// Summary is one group's traffic over a whole run. Max includes queries still unfinished at the end.
type Summary struct {
	Group  string  `json:"group"`
	OK     int     `json:"ok"`
	Errors int     `json:"errors"`
	P50    float64 `json:"p50"`
	P99    float64 `json:"p99"`
	Max    float64 `json:"max"`
}

type stats struct {
	mu           sync.Mutex
	window       []float64
	windowErrors int
	lastError    string
	all          []float64
	errors       int
	worst        float64
	last         float64
	inFlight     map[int]time.Time // worker -> query start
}

func newStats() *stats {
	return &stats{inFlight: map[int]time.Time{}}
}

func (s *stats) start(worker int) time.Time {
	now := time.Now()
	s.mu.Lock()
	s.inFlight[worker] = now
	s.mu.Unlock()
	return now
}

func (s *stats) finish(worker int, started time.Time, err error) {
	elapsed := time.Since(started).Seconds()
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.inFlight, worker)
	s.worst = max(s.worst, elapsed)
	if err != nil {
		s.windowErrors++
		s.errors++
		s.lastError = firstLine(err.Error())
		return
	}
	s.window = append(s.window, elapsed)
	s.all = append(s.all, elapsed)
	s.last = elapsed
}

// abandon forgets a query cancelled because the load is stopping.
func (s *stats) abandon(worker int) {
	s.mu.Lock()
	delete(s.inFlight, worker)
	s.mu.Unlock()
}

// stuck returns the age of the oldest unfinished query and counts it towards the worst latency.
// The caller holds the lock.
func (s *stats) stuck(now time.Time) float64 {
	var oldest float64
	for _, started := range s.inFlight {
		oldest = max(oldest, now.Sub(started).Seconds())
	}
	s.worst = max(s.worst, oldest)
	return oldest
}

func (s *stats) takeWindow(group string, stuckAfter time.Duration, now time.Time) Window {
	s.mu.Lock()
	defer s.mu.Unlock()
	w := Window{
		Group:      group,
		Count:      len(s.window),
		Errors:     s.windowErrors,
		P50:        percentile(s.window, 0.5),
		P99:        percentile(s.window, 0.99),
		Stuck:      s.stuck(now),
		StuckAfter: stuckAfter.Seconds(),
		Last:       s.last,
		LastError:  s.lastError,
	}
	if len(s.window) > 0 {
		w.Max = slices.Max(s.window)
	}
	s.window = s.window[:0]
	s.windowErrors = 0
	s.lastError = ""
	return w
}

func (s *stats) summary(group string) Summary {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stuck(time.Now())
	return Summary{
		Group:  group,
		OK:     len(s.all),
		Errors: s.errors,
		P50:    percentile(s.all, 0.5),
		P99:    percentile(s.all, 0.99),
		Max:    s.worst,
	}
}

func percentile(values []float64, share float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := slices.Clone(values)
	slices.Sort(sorted)
	return sorted[min(len(sorted)-1, int(float64(len(sorted))*share))]
}

func firstLine(text string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(text), "\n")
	return line
}
