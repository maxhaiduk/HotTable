ROWS ?= 20000000
LAB  ?= labs/01-index-on-busy-table

COMPOSE := docker compose
TOOLS   := $(COMPOSE) --progress quiet run --rm tools

.PHONY: help up down reset seed load watch psql psql-replica forgotten-tx check

help: ## list the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-14s %s\n", $$1, $$2}'

up: ## start primary + replica, build the tools image
	$(COMPOSE) --profile tools build tools
	$(COMPOSE) up -d --wait primary replica

down: ## stop the containers, keep the data
	$(COMPOSE) down

reset: ## stop the containers and delete all data
	$(COMPOSE) down --volumes

seed: ## (re)create the lab's data, ROWS=20000000 by default
	$(TOOLS) psql -X -v rows=$(ROWS) -f $(LAB)/seed.sql

load: ## run the load generator; Ctrl+C prints the run's summary
	$(TOOLS) python3 tools/loadgen.py

watch: ## live view: sessions, locks, index builds, replica lag
	$(TOOLS) watch -n 1 -t psql -X -q -f tools/status.sql

psql: ## psql on the primary
	$(TOOLS) psql

psql-replica: ## psql on the replica (read-only)
	$(TOOLS) psql -h replica

forgotten-tx: ## open a transaction and leave it idle until Enter
	$(TOOLS) psql -X -f $(LAB)/forgotten_tx.sql

check: ## check the lab's success criteria
	$(TOOLS) python3 $(LAB)/check.py
