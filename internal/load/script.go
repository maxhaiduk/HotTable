package load

import (
	"fmt"
	"math/rand/v2"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// Script is one transaction in pgbench's script format, reduced to what the labs need:
// `\set name random(min, max)` lines followed by one SQL statement that uses :name variables.
// The same file runs under real pgbench with the lab's variables passed as -D name=value.
type Script struct {
	File   string
	Weight int
	sets   []set
	sql    string   // the statement with $1..$n in place of the variables
	args   []string // the variable behind each $n
}

type set struct {
	name     string
	min, max operand
}

// operand is an integer literal or, when name is set, a variable.
type operand struct {
	value int64
	name  string
}

var setLine = regexp.MustCompile(`^\\set\s+(\w+)\s+random\(\s*([^,\s]+)\s*,\s*([^)\s]+)\s*\)\s*;?$`)

// ParseScript reads a script file.
func ParseScript(file string, weight int) (*Script, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	s := &Script{File: file, Weight: weight}
	var sqlLines []string
	for i, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case trimmed == "" || strings.HasPrefix(trimmed, "--"):
		case strings.HasPrefix(trimmed, `\`):
			m := setLine.FindStringSubmatch(trimmed)
			if m == nil {
				return nil, fmt.Errorf("%s:%d: only `\\set name random(min, max)` is supported", file, i+1)
			}
			low, err := parseOperand(m[2])
			if err != nil {
				return nil, fmt.Errorf("%s:%d: %w", file, i+1, err)
			}
			high, err := parseOperand(m[3])
			if err != nil {
				return nil, fmt.Errorf("%s:%d: %w", file, i+1, err)
			}
			s.sets = append(s.sets, set{name: m[1], min: low, max: high})
		default:
			sqlLines = append(sqlLines, line)
		}
	}
	sql := strings.TrimSuffix(strings.TrimSpace(strings.Join(sqlLines, "\n")), ";")
	if sql == "" {
		return nil, fmt.Errorf("%s: no SQL statement", file)
	}
	s.sql, s.args = bindVariables(sql)
	return s, nil
}

func parseOperand(text string) (operand, error) {
	if name, ok := strings.CutPrefix(text, ":"); ok {
		return operand{name: name}, nil
	}
	value, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return operand{}, fmt.Errorf("%q is neither an integer nor a :variable", text)
	}
	return operand{value: value}, nil
}

// bindVariables turns :name references into $n parameters,
// leaving :: casts and string literals alone.
func bindVariables(sql string) (string, []string) {
	var out strings.Builder
	var names []string
	index := map[string]int{}
	inString := false
	for i := 0; i < len(sql); i++ {
		c := sql[i]
		switch {
		case c == '\'':
			inString = !inString
			out.WriteByte(c)
		case inString:
			out.WriteByte(c)
		case c == ':' && i+1 < len(sql) && sql[i+1] == ':':
			out.WriteString("::")
			i++
		case c == ':' && i+1 < len(sql) && isIdentStart(sql[i+1]):
			end := i + 1
			for end < len(sql) && isIdentPart(sql[end]) {
				end++
			}
			name := sql[i+1 : end]
			n, ok := index[name]
			if !ok {
				names = append(names, name)
				n = len(names)
				index[name] = n
			}
			fmt.Fprintf(&out, "$%d", n)
			i = end - 1
		default:
			out.WriteByte(c)
		}
	}
	return out.String(), names
}

func isIdentStart(c byte) bool {
	return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func isIdentPart(c byte) bool {
	return isIdentStart(c) || (c >= '0' && c <= '9')
}

// values draws the script's \set variables and returns the statement's parameters.
func (s *Script) values(vars map[string]int64) ([]any, error) {
	local := make(map[string]int64, len(s.sets))
	resolve := func(o operand) (int64, error) {
		if o.name == "" {
			return o.value, nil
		}
		if v, ok := local[o.name]; ok {
			return v, nil
		}
		if v, ok := vars[o.name]; ok {
			return v, nil
		}
		return 0, fmt.Errorf("%s: unknown variable :%s", s.File, o.name)
	}
	for _, st := range s.sets {
		low, err := resolve(st.min)
		if err != nil {
			return nil, err
		}
		high, err := resolve(st.max)
		if err != nil {
			return nil, err
		}
		if high < low {
			return nil, fmt.Errorf("%s: random(%d, %d) for :%s is empty", s.File, low, high, st.name)
		}
		local[st.name] = low + rand.Int64N(high-low+1)
	}
	args := make([]any, len(s.args))
	for i, name := range s.args {
		v, err := resolve(operand{name: name})
		if err != nil {
			return nil, err
		}
		args[i] = v
	}
	return args, nil
}
