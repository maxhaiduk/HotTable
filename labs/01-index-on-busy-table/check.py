#!/usr/bin/env python3
"""Lab 1 end state: on the primary and on the replica, a valid index on orders
serves the lookup query without a separate sort, and no invalid index is left."""

import json
import sys

import psycopg

LOOKUP = (
    "SELECT id, status, amount, created_at FROM orders "
    "WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20"
)

INDEXES = """
SELECT c.relname,
       i.indisvalid,
       (SELECT array_agg(a.attname ORDER BY k.ord)
          FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute AS a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS columns
FROM pg_index AS i
JOIN pg_class AS c ON c.oid = i.indexrelid
WHERE i.indrelid = 'orders'::regclass
"""


def plan_nodes(node):
    yield node
    for child in node.get("Plans", []):
        yield from plan_nodes(child)


def check(title, conn):
    print(title)
    passed = True

    def report(ok, text):
        nonlocal passed
        passed &= ok
        print(f"  {'✓' if ok else '✗'} {text}")

    indexes = conn.execute(INDEXES).fetchall()
    invalid = [name for name, valid, _ in indexes if not valid]
    report(not invalid, "немає INVALID індексів" if not invalid else f"INVALID індекси: {', '.join(invalid)}")

    candidates = [name for name, valid, columns in indexes if valid and columns and columns[0] == "customer_id"]
    report(bool(candidates), f"валідний індекс з customer_id першою колонкою: {', '.join(candidates) or 'немає'}")

    plan = conn.execute("EXPLAIN (FORMAT JSON) " + LOOKUP).fetchone()[0]
    if isinstance(plan, str):
        plan = json.loads(plan)
    nodes = list(plan_nodes(plan[0]["Plan"]))
    used = sorted({n["Index Name"] for n in nodes if n.get("Index Name") in candidates})
    sorts = [n["Node Type"] for n in nodes if "Sort" in n["Node Type"]]
    report(bool(used), f"lookup-запит іде через індекс: {', '.join(used) or 'ні, ' + nodes[0]['Node Type']}")
    report(
        not sorts,
        "без окремого сортування" if not sorts
        else f"план сортує окремо ({', '.join(sorts)}): індекс не покриває ORDER BY created_at",
    )
    return passed


def main():
    with psycopg.connect(autocommit=True) as primary, psycopg.connect(host="replica", autocommit=True) as replica:
        ok = check("primary", primary)
        ok = check("replica", replica) and ok
    print("\nГОТОВО: індекс на місці." if ok else "\nЩе не все.")
    print("Не забудь критерій навантаження: у підсумку прогону write err = 0 і write max < 10s.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
