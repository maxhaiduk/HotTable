#!/usr/bin/env python3
"""Steady traffic against `orders`, reported once a second.

Writers update and insert orders, readers fetch orders by primary key, and one
lookup worker runs the lab's "latest orders of a customer" query. Each line shows
throughput, p99 latency, errors, and STUCK: how long the oldest unfinished query
of that kind has been waiting. Ctrl+C prints a summary of the whole run.

Tuning through the environment: WRITERS, READERS, RATE (ops/s per worker),
LOOKUP_EVERY (seconds between lookups).
"""

import os
import random
import sys
import threading
import time

import psycopg

WRITERS = int(os.environ.get("WRITERS", "4"))
READERS = int(os.environ.get("READERS", "4"))
RATE = float(os.environ.get("RATE", "50"))
LOOKUP_EVERY = float(os.environ.get("LOOKUP_EVERY", "3"))

LOOKUP_SQL = (
    "SELECT id, status, amount, created_at FROM orders "
    "WHERE customer_id = %s ORDER BY created_at DESC LIMIT 20"
)
OPS = ("write", "read", "lookup")
# Seconds an unfinished query must wait before the line shows it as STUCK.
# A lookup without its index scans the whole table and normally takes a second or two.
STUCK_AFTER = {"write": 0.5, "read": 0.5, "lookup": 5.0}

COLOR = sys.stdout.isatty()


def red(text):
    return f"\033[31m{text}\033[0m" if COLOR else text


def fmt(seconds):
    if seconds is None:
        return "-"
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    return f"{seconds:.1f}s"


def percentile(values, share):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * share))]


class Stats:
    """Latencies per operation: the current second's window and the whole run."""

    def __init__(self):
        self.lock = threading.Lock()
        self.window = {op: [] for op in OPS}
        self.window_errors = {op: 0 for op in OPS}
        self.latencies = {op: [] for op in OPS}
        self.errors = {op: 0 for op in OPS}
        self.worst = {op: 0.0 for op in OPS}
        self.last = {op: None for op in OPS}
        self.new_errors = []
        self.in_flight = {}  # thread id -> (op, started)

    def start(self, op):
        started = time.monotonic()
        with self.lock:
            self.in_flight[threading.get_ident()] = (op, started)
        return started

    def finish(self, op, started, error=None):
        elapsed = time.monotonic() - started
        with self.lock:
            self.in_flight.pop(threading.get_ident(), None)
            self.worst[op] = max(self.worst[op], elapsed)
            if error is None:
                self.window[op].append(elapsed)
                self.latencies[op].append(elapsed)
                self.last[op] = elapsed
            else:
                self.window_errors[op] += 1
                self.errors[op] += 1
                self.new_errors.append(f"{op}: {error}")

    def take_window(self):
        now = time.monotonic()
        with self.lock:
            stuck = {op: 0.0 for op in OPS}
            for op, started in self.in_flight.values():
                stuck[op] = max(stuck[op], now - started)
            for op in OPS:
                self.worst[op] = max(self.worst[op], stuck[op])
            snapshot = {
                op: (self.window[op], self.window_errors[op], stuck[op], self.last[op])
                for op in OPS
            }
            errors = self.new_errors
            self.window = {op: [] for op in OPS}
            self.window_errors = {op: 0 for op in OPS}
            self.new_errors = []
            return snapshot, errors


def connect(app):
    while True:
        try:
            return psycopg.connect(autocommit=True, application_name=app)
        except psycopg.OperationalError as error:
            print(f"{app}: cannot connect ({first_line(error)}), retrying", flush=True)
            time.sleep(1)


def first_line(error):
    return str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__


def worker(stats, app, interval, next_query):
    conn = connect(app)
    while True:
        cycle_started = time.monotonic()
        op, sql, params = next_query()
        started = stats.start(op)
        try:
            conn.execute(sql, params).fetchall()
        except psycopg.Error as error:
            stats.finish(op, started, first_line(error))
            if conn.broken or conn.closed:
                conn = connect(app)
        else:
            stats.finish(op, started)
        time.sleep(max(0.0, interval - (time.monotonic() - cycle_started)))


def write_query(max_order_id, customers):
    if random.random() < 0.7:
        return (
            "write",
            "UPDATE orders SET status = %s, updated_at = now() WHERE id = %s RETURNING id",
            (random.randint(0, 4), random.randint(1, max_order_id)),
        )
    return (
        "write",
        "INSERT INTO orders (customer_id, status, amount, created_at, updated_at) "
        "VALUES (%s, 0, %s, now(), now()) RETURNING id",
        (random.randint(1, customers), round(random.uniform(1, 1000), 2)),
    )


def read_query(max_order_id):
    return "read", "SELECT * FROM orders WHERE id = %s", (random.randint(1, max_order_id),)


def lookup_query(customers):
    return "lookup", LOOKUP_SQL, (random.randint(1, customers),)


def report_line(snapshot):
    parts = []
    for op in OPS:
        window, errors, stuck, last = snapshot[op]
        if op == "lookup":
            text = f"lookup last {fmt(last):>6}"
        else:
            text = f"{op} {len(window):>4}/s p99 {fmt(percentile(window, 0.99)):>6}"
        if errors:
            text += red(f" ERR {errors}")
        if stuck >= STUCK_AFTER[op]:
            text += red(f" STUCK {fmt(stuck)}")
        parts.append(text)
    return f"{time.strftime('%H:%M:%S')}  " + " | ".join(parts)


def print_summary(stats, duration):
    print(f"\n=== Підсумок за {duration:.0f} с ===")
    print(f"{'op':<8}{'ok':>9}{'err':>7}{'p50':>9}{'p99':>9}{'max':>9}")
    with stats.lock:
        for op in OPS:
            values = stats.latencies[op]
            print(
                f"{op:<8}{len(values):>9}{stats.errors[op]:>7}"
                f"{fmt(percentile(values, 0.5)):>9}{fmt(percentile(values, 0.99)):>9}"
                f"{fmt(stats.worst[op]):>9}"
            )
    print("max враховує і запити, що ще не завершились у момент зупинки.")


def main():
    try:
        with psycopg.connect() as conn:
            max_order_id = conn.execute("SELECT max(id) FROM orders").fetchone()[0]
            customers = conn.execute("SELECT max(id) FROM customers").fetchone()[0]
    except psycopg.errors.UndefinedTable:
        sys.exit("Таблиць ще немає: спершу make seed.")

    print(
        f"orders до id {max_order_id:,}, customers {customers:,}; "
        f"writers {WRITERS}×{RATE:g}/s, readers {READERS}×{RATE:g}/s, "
        f"lookup кожні {LOOKUP_EVERY:g} с. Ctrl+C — підсумок.",
        flush=True,
    )

    stats = Stats()
    workers = (
        [("loadgen-writer", 1 / RATE, lambda: write_query(max_order_id, customers))] * WRITERS
        + [("loadgen-reader", 1 / RATE, lambda: read_query(max_order_id))] * READERS
        + [("loadgen-lookup", LOOKUP_EVERY, lambda: lookup_query(customers))]
    )
    for app, interval, next_query in workers:
        threading.Thread(target=worker, args=(stats, app, interval, next_query), daemon=True).start()

    started = time.monotonic()
    try:
        while True:
            time.sleep(1 - (time.monotonic() - started) % 1)
            snapshot, errors = stats.take_window()
            print(report_line(snapshot), flush=True)
            for error in sorted(set(errors)):
                print(red(f"          {error}"), flush=True)
    except KeyboardInterrupt:
        print_summary(stats, time.monotonic() - started)


if __name__ == "__main__":
    main()
