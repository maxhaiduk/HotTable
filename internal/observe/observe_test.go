package observe

import (
	"context"
	"os"
	"testing"
)

// Runs against a seeded stand: LABD_TEST_DSN=postgres://postgres:postgres@127.0.0.1:55432/lab go test ./internal/observe
func TestSnapshotOfSeededStand(t *testing.T) {
	dsn := os.Getenv("LABD_TEST_DSN")
	if dsn == "" {
		t.Skip("LABD_TEST_DSN is not set")
	}
	s := New(dsn, "orders", []string{"orders_part"}).Snapshot(context.Background())
	if s.Error != "" {
		t.Fatal(s.Error)
	}
	if s.Version == "" {
		t.Error("no server version")
	}
	if s.Table == nil || s.Table.Rows <= 0 || s.Table.Bytes <= 0 {
		t.Fatalf("table = %+v, want rows and bytes of the seeded orders", s.Table)
	}
	if len(s.Indexes) == 0 || len(s.Replicas) == 0 {
		t.Errorf("indexes = %d, replicas = %d; want both", len(s.Indexes), len(s.Replicas))
	}
	t.Logf("PostgreSQL %s, orders ≈ %d rows, %d dead, %d bytes", s.Version, s.Table.Rows, s.Table.DeadRows, s.Table.Bytes)
}
