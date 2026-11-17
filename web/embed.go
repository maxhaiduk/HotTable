// Package web holds the built UI (web/dist, made by `npm run build`) for labd to serve.
package web

import "embed"

//go:embed all:dist
var Dist embed.FS
