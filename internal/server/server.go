// Package server is labd's HTTP side: the lab's API, the live stream of load and database
// state, terminals, and the web UI itself.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"hot-table/internal/lab"
	"hot-table/internal/load"
	"hot-table/internal/observe"
	"hot-table/internal/term"
)

// Frame is one second of the live stream.
type Frame struct {
	T    int64         `json:"t"` // unix seconds
	Load []load.Window `json:"load"`
	DB   observe.State `json:"db"`
}

// historySize is how many seconds a newly opened page gets to draw its charts from.
const historySize = 300

// Server ties the lab, its load and its observer to HTTP.
type Server struct {
	lab        *lab.Lab
	gen        *load.Generator
	obs        *observe.Observer
	projectDir string
	mux        *http.ServeMux
	mu       sync.Mutex
	history  []Frame
	watchers map[chan Frame]struct{}
}

// New builds the server; Run must run for the live stream to have frames.
func New(l *lab.Lab, gen *load.Generator, obs *observe.Observer, ui fs.FS, projectDir string) *Server {
	s := &Server{
		lab: l, gen: gen, obs: obs, projectDir: projectDir,
		mux: http.NewServeMux(), watchers: map[chan Frame]struct{}{},
	}
	s.mux.HandleFunc("GET /api/lab", s.getLab)
	s.mux.HandleFunc("GET /api/load", s.getLoad)
	s.mux.HandleFunc("POST /api/load", s.postLoad)
	s.mux.HandleFunc("POST /api/check", s.postCheck)
	s.mux.HandleFunc("GET /ws/live", s.live)
	s.mux.Handle("GET /ws/term", term.Handler{Dir: projectDir})
	s.mux.Handle("GET /", spa(ui))
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

// Run takes a frame every second until ctx ends.
func (s *Server) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			frame := Frame{T: now.Unix(), Load: s.gen.Windows(), DB: s.obs.Snapshot(ctx)}
			s.publish(frame)
		}
	}
}

func (s *Server) publish(frame Frame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.history = append(s.history, frame)
	if len(s.history) > historySize {
		s.history = s.history[len(s.history)-historySize:]
	}
	for ch := range s.watchers {
		select {
		case ch <- frame:
		default: // a slow page skips a frame rather than holding everyone up
		}
	}
}

func (s *Server) getLab(w http.ResponseWriter, _ *http.Request) {
	readme, err := s.lab.README()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"lab": s.lab, "readme": readme})
}

func (s *Server) getLoad(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, s.gen.Status())
}

func (s *Server) postLoad(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Running bool `json:"running"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if !req.Running {
		writeJSON(w, s.gen.Stop())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if err := s.gen.Start(ctx); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, s.gen.Status())
}

// postCheck runs the lab's check.py in the console container, as `make check` does.
func (s *Server) postCheck(w http.ResponseWriter, r *http.Request) {
	dir := s.lab.Dir
	if filepath.IsAbs(dir) {
		rel, err := filepath.Rel(s.projectDir, dir)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		dir = rel
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "compose", "exec", "-T", "console",
		"python3", path.Join(filepath.ToSlash(dir), "check.py"))
	cmd.Dir = s.projectDir
	output, err := cmd.CombinedOutput()
	var exit *exec.ExitError
	if err != nil && !errors.As(err, &exit) {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"ok": err == nil, "output": string(output)})
}

// live streams frames: first the history, then one per second.
func (s *Server) live(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:*", "127.0.0.1:*"},
	})
	if err != nil {
		return
	}
	defer ws.CloseNow()
	ctx := ws.CloseRead(r.Context())

	ch := make(chan Frame, 4)
	s.mu.Lock()
	history := append([]Frame(nil), s.history...)
	s.watchers[ch] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.watchers, ch)
		s.mu.Unlock()
	}()

	if send(ctx, ws, map[string]any{"history": history}) != nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case frame := <-ch:
			if send(ctx, ws, map[string]any{"frame": frame}) != nil {
				return
			}
		}
	}
}

func send(ctx context.Context, ws *websocket.Conn, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return ws.Write(ctx, websocket.MessageText, data)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// spa serves the built UI; any path that is not a file gets index.html.
func spa(ui fs.FS) http.Handler {
	files := http.FileServerFS(ui)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if _, err := fs.Stat(ui, path); err == nil {
				files.ServeHTTP(w, r)
				return
			}
		}
		http.ServeFileFS(w, r, ui, "index.html")
	})
}
