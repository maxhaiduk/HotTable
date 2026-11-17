package load

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestBindVariables(t *testing.T) {
	sql, args := bindVariables("SELECT :a::int, ':not_a_var', :b, :a FROM t WHERE x = :b")
	if want := "SELECT $1::int, ':not_a_var', $2, $1 FROM t WHERE x = $2"; sql != want {
		t.Errorf("sql = %q, want %q", sql, want)
	}
	if want := []string{"a", "b"}; !slices.Equal(args, want) {
		t.Errorf("args = %v, want %v", args, want)
	}
}

func TestScriptValues(t *testing.T) {
	file := filepath.Join(t.TempDir(), "s.sql")
	script := "-- comment\n\\set id random(1, :max_id)\n\\set k random(5, 5)\nUPDATE t SET k = :k\nWHERE id = :id;\n"
	if err := os.WriteFile(file, []byte(script), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := ParseScript(file, 1)
	if err != nil {
		t.Fatal(err)
	}
	if want := "UPDATE t SET k = $1\nWHERE id = $2"; s.sql != want {
		t.Errorf("sql = %q, want %q", s.sql, want)
	}
	for range 100 {
		args, err := s.values(map[string]int64{"max_id": 3})
		if err != nil {
			t.Fatal(err)
		}
		if args[0] != int64(5) || args[1].(int64) < 1 || args[1].(int64) > 3 {
			t.Fatalf("args = %v, want [5, 1..3]", args)
		}
	}
	if _, err := s.values(nil); err == nil {
		t.Error("an unknown variable should fail")
	}
}

func TestParseScriptRejectsOtherMetaCommands(t *testing.T) {
	file := filepath.Join(t.TempDir(), "s.sql")
	if err := os.WriteFile(file, []byte("\\sleep 1 ms\nSELECT 1;\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseScript(file, 1); err == nil {
		t.Error("\\sleep should be rejected")
	}
}
