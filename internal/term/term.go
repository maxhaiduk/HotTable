// Package term connects a browser terminal (xterm.js) to psql in the console container:
// the process runs under a PTY, its bytes go over a WebSocket both ways.
package term

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/creack/pty"
)

// Targets are psql's arguments for each terminal a page may open. Nothing else can be started.
var Targets = map[string][]string{
	"primary": {},
	"replica": {"-h", "replica"},
}

// markerVar tags each terminal's psql on its command line (psql -v labd_term=<labd pid>-<id>), so
// that labd can end it: stopping `docker compose exec` leaves the process inside the container
// running, and an abandoned session could keep a transaction open for good. The PID tells which
// labd a session belongs to, so two of them can share one stand.
const markerVar = "labd_term"

var markerPID = regexp.MustCompile(markerVar + `=(\d+)-`)

func ownPrefix(pid int) string {
	return fmt.Sprintf("%s=%d-", markerVar, pid)
}

// Handler serves one terminal per WebSocket; ?target= picks the command.
type Handler struct {
	// Dir is where docker compose finds the project.
	Dir string
}

type control struct {
	Resize []uint16 `json:"resize"`
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	args, ok := Targets[r.URL.Query().Get("target")]
	if !ok {
		http.Error(w, "unknown target", http.StatusBadRequest)
		return
	}
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:*", "127.0.0.1:*"},
	})
	if err != nil {
		return
	}
	defer ws.CloseNow()

	marker := ownPrefix(os.Getpid()) + newMarker()
	command := append([]string{"compose", "exec", "console", "psql", "-v", marker}, args...)
	cmd := exec.Command("docker", command...)
	cmd.Dir = h.Dir
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 24, Cols: 80})
	if err != nil {
		ws.Close(websocket.StatusInternalError, err.Error())
		return
	}
	defer func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		_ = ptmx.Close()
		h.kill(marker)
	}()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go func() {
		defer cancel()
		buf := make([]byte, 32*1024)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				if ws.Write(ctx, websocket.MessageBinary, buf[:n]) != nil {
					return
				}
			}
			if err != nil {
				ws.Close(websocket.StatusNormalClosure, "process exited")
				return
			}
		}
	}()

	for {
		kind, data, err := ws.Read(ctx)
		if err != nil {
			return
		}
		if kind == websocket.MessageText {
			var c control
			if json.Unmarshal(data, &c) == nil && len(c.Resize) == 2 {
				_ = pty.Setsize(ptmx, &pty.Winsize{Cols: c.Resize[0], Rows: c.Resize[1]})
			}
			continue
		}
		if _, err := ptmx.Write(data); err != nil {
			log.Printf("term: %v", err)
			return
		}
	}
}

// KillOwn ends the psql of every terminal this labd opened.
func (h Handler) KillOwn() {
	h.kill(ownPrefix(os.Getpid()))
}

// KillOrphans ends the psql sessions of labd processes that are gone, leaving live ones alone.
func (h Handler) KillOrphans() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "compose", "exec", "-T", "console", "ps", "-eo", "args")
	cmd.Dir = h.Dir
	out, err := cmd.Output()
	if err != nil {
		return
	}
	done := map[int]bool{}
	for _, m := range markerPID.FindAllStringSubmatch(string(out), -1) {
		pid, _ := strconv.Atoi(m[1])
		if done[pid] || alive(pid) {
			continue
		}
		done[pid] = true
		h.kill(ownPrefix(pid))
	}
}

// alive tells whether a process with this PID runs on this host; EPERM still means it exists.
func alive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

func (h Handler) kill(pattern string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "compose", "exec", "-T", "console", "pkill", "-f", pattern)
	cmd.Dir = h.Dir
	_ = cmd.Run() // pkill exits 1 when nothing matched
}

func newMarker() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
