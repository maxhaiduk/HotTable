// Package lab reads a lab's definition: labs/NN-name/lab.yaml and the files next to it.
package lab

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/yaml.v3"
)

// Lab is one lab: what it is about and the traffic that runs while it is being solved.
type Lab struct {
	ID    string `yaml:"-" json:"id"`
	Dir   string `yaml:"-" json:"-"`
	Title string `yaml:"title" json:"title"`
	// Table is the table the lab is about: the locks and indexes panels watch it.
	Table string `yaml:"table" json:"table"`
	// Vars are computed once when the load starts, each by a query returning one integer.
	Vars map[string]string `yaml:"vars" json:"-"`
	Load []Group           `yaml:"load" json:"load"`
}

// Group is one kind of traffic, such as writes, with its own workers and pace.
type Group struct {
	Name    string `yaml:"name" json:"name"`
	Workers int    `yaml:"workers" json:"workers"`
	// Rate is transactions per second per worker; Every is the pause between them instead.
	Rate  float64       `yaml:"rate" json:"rate,omitempty"`
	Every time.Duration `yaml:"every" json:"-"`
	// StuckAfter is how long an unfinished query waits before it counts as stuck.
	StuckAfter time.Duration `yaml:"stuck_after" json:"-"`
	Scripts    []ScriptRef   `yaml:"scripts" json:"-"`
}

// ScriptRef points to a transaction script in pgbench format, relative to the lab's directory.
type ScriptRef struct {
	File   string `yaml:"file"`
	Weight int    `yaml:"weight"`
}

// Interval is the time one worker of the group spends per transaction, waiting included.
func (g Group) Interval() time.Duration {
	if g.Every > 0 {
		return g.Every
	}
	return time.Duration(float64(time.Second) / g.Rate)
}

// Read loads the lab in dir.
func Read(dir string) (*Lab, error) {
	data, err := os.ReadFile(filepath.Join(dir, "lab.yaml"))
	if err != nil {
		return nil, err
	}
	var l Lab
	if err := yaml.Unmarshal(data, &l); err != nil {
		return nil, fmt.Errorf("%s/lab.yaml: %w", dir, err)
	}
	l.Dir = dir
	l.ID = filepath.Base(dir)
	for i := range l.Load {
		g := &l.Load[i]
		if g.Workers <= 0 || (g.Rate <= 0 && g.Every <= 0) || len(g.Scripts) == 0 {
			return nil, fmt.Errorf("%s/lab.yaml: load group %q needs workers, rate or every, and scripts", dir, g.Name)
		}
		if g.StuckAfter == 0 {
			g.StuckAfter = 500 * time.Millisecond
		}
		for j := range g.Scripts {
			if g.Scripts[j].Weight <= 0 {
				g.Scripts[j].Weight = 1
			}
		}
	}
	return &l, nil
}

// README returns the lab's text in markdown.
func (l *Lab) README() (string, error) {
	data, err := os.ReadFile(filepath.Join(l.Dir, "README.md"))
	return string(data), err
}

// Path resolves a file name relative to the lab's directory.
func (l *Lab) Path(name string) string {
	return filepath.Join(l.Dir, name)
}
