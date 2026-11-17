// labd serves the web UI of the labs: it runs a lab's load, watches the database
// and gives the browser live charts and psql terminals.
package main

import (
	"context"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"db-problem-emulator/internal/lab"
	"db-problem-emulator/internal/load"
	"db-problem-emulator/internal/observe"
	"db-problem-emulator/internal/server"
	"db-problem-emulator/internal/term"
	"db-problem-emulator/web"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:7070", "address to listen on")
	labDir := flag.String("lab", "labs/01-index-on-busy-table", "the lab's directory")
	dsn := flag.String("dsn", envOr("LABD_DSN", "postgres://postgres:postgres@127.0.0.1:55432/lab"), "the primary")
	flag.Parse()

	l, err := lab.Read(*labDir)
	if err != nil {
		log.Fatal(err)
	}
	gen, err := load.New(l, *dsn)
	if err != nil {
		log.Fatal(err)
	}
	ui, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		log.Fatal(err)
	}
	project, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	terminals := term.Handler{Dir: project}
	terminals.KillAll() // psql sessions an earlier labd left behind

	srv := server.New(l, gen, observe.New(*dsn, l.Table), ui, project)
	go srv.Run(ctx)
	httpServer := &http.Server{Addr: *addr, Handler: srv}
	go func() {
		<-ctx.Done()
		gen.Stop()
		terminals.KillAll()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdown)
	}()

	log.Printf("labd: %s on http://%s", l.Title, *addr)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
