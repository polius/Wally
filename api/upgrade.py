"""The upgrade from Wally 1.x, checked and explained.

Before the upgrade is kept, everything a 1.x household held is compared with what is there
after it, field by field, read with plain SQL: every transaction, rule, category, tag, currency
and setting. The only change allowed is the one 2.0 makes on purpose: charges that 1.x added in
advance for dates after today are taken out, because 2.0 adds each one on its day. Anything else
and the upgrade is undone (see database.migrate_db). What happened is written to a report, in the
data folder and shown once in the app.

Try it first on a copy, without touching anything:

    python -m api.upgrade --check [path/to/wally.db]
    docker run --rm -v /path/to/data:/wally/data poliuscorp/wally python3 -m api.upgrade --check
"""
import json
import sqlite3
import sys
import tempfile
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

class UpgradeCheckFailed(Exception):
    """The upgraded database is not what the old one held. Nothing is kept."""

# Settings the upgrade itself adds or changes
OWN_KEYS = {"ONBOARDED", "SCHEMA_VERSION"}

def _tables(conn) -> set[str]:
    return {r[0] for r in conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}

def _rows(conn, sql: str, tables: set[str], table: str) -> list[tuple]:
    return conn.exec_driver_sql(sql).fetchall() if table in tables else []

def snapshot(conn) -> dict:
    """What the household holds, from the columns every 1.x release had. Values as stored."""
    t = _tables(conn)
    return {
        "transactions": {r[0]: r[1:] for r in _rows(conn, 'SELECT id, date, name, category, amount, type, tags, "recurringID" FROM "transaction"', t, "transaction")},
        "rules": {r[0]: r[1:] for r in _rows(conn, 'SELECT id, name, category, amount, type, "startDate", "endDate", frequency, tags FROM recurringtransaction', t, "recurringtransaction")},
        "categories": sorted(r[0] for r in _rows(conn, "SELECT name FROM category", t, "category")),
        "tags": sorted(r[0] for r in _rows(conn, "SELECT name FROM tag", t, "tag")),
        "currencies": sorted(_rows(conn, "SELECT name, symbol FROM currency", t, "currency")),
        "settings": {k: v for k, v in _rows(conn, "SELECT key, value FROM appconfig", t, "appconfig") if k not in OWN_KEYS},
    }

def _future(rows: dict, today: date) -> set:
    """Charges 1.x made in advance: from a rule, dated after today."""
    return {i for i, r in rows.items() if r[6] and str(r[0])[:10] > today.isoformat()}

def verify(before: dict, after: dict, today: date):
    """Raise UpgradeCheckFailed unless after is before, less the charges made in advance."""
    problems = []
    removed = _future(before["transactions"], today)
    want = {i: r for i, r in before["transactions"].items() if i not in removed}
    have = after["transactions"]
    missing, extra = set(want) - set(have), set(have) - set(want)
    changed = [i for i in set(want) & set(have) if tuple(want[i]) != tuple(have[i])]
    if missing:
        problems.append(f"{len(missing)} transactions are missing")
    if extra:
        problems.append(f"{len(extra)} transactions appeared")
    if changed:
        problems.append(f"{len(changed)} transactions changed")
    for key in ("rules", "categories", "tags", "currencies"):
        if before[key] != after[key]:
            problems.append(f"the {key} changed")
    for k, v in before["settings"].items():
        if after["settings"].get(k) != v:
            problems.append(f"the setting {k} changed")
    if problems:
        raise UpgradeCheckFailed("; ".join(problems))

def _cents(value) -> int | None:
    try:
        return int((Decimal(str(value)) * 100).to_integral_value())
    except (InvalidOperation, ValueError, TypeError):
        return None

def _exact(total: Decimal) -> str:
    """To the cent, unless an amount typed with more decimals makes it more exact than that"""
    return f"{total:.2f}" if total == total.quantize(Decimal("0.01")) else str(total)

def report(before: dict, today: date, version: str, backup: str | None) -> dict:
    """What was kept and what changed, in figures a person can check against 1.x."""
    removed_ids = _future(before["transactions"], today)
    kept = [r for i, r in before["transactions"].items() if i not in removed_ids]
    totals = {"expense": Decimal(0), "income": Decimal(0)}
    for r in kept:
        try:
            totals["income" if r[4] == "income" else "expense"] += Decimal(str(r[3]))
        except (InvalidOperation, ValueError):
            pass
    dates = sorted(str(r[0])[:10] for r in kept)
    removed = sorted(({"date": str(r[0])[:10], "name": r[1], "amount": str(r[3])} for i, r in before["transactions"].items() if i in removed_ids), key=lambda x: (x["date"], x["name"]))
    notes = []
    odd = [r for r in kept if _cents(r[3]) is not None and Decimal(str(r[3])) * 100 != _cents(r[3])]
    if odd:
        notes.append({"kind": "decimals", "count": len(odd), "examples": [{"date": str(r[0])[:10], "name": r[1], "amount": str(r[3])} for r in odd[:5]]})
    unknown = sorted({r[2] for r in kept} - set(before["categories"]))
    if unknown:
        notes.append({"kind": "categories", "count": len(unknown), "examples": unknown[:5]})
    return {
        "from": "1.x", "to": version, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "today": today.isoformat(), "backup": backup,
        "kept": {
            "transactions": len(kept), "first": dates[0] if dates else None, "last": dates[-1] if dates else None,
            "expense": _exact(totals["expense"]), "income": _exact(totals["income"]),
            "rules": len(before["rules"]), "categories": len(before["categories"]), "tags": len(before["tags"]),
            "password": bool(before["settings"].get("LOGIN_PASSWORD")),
            "settings": [name for key, name in (("SELECTED_CURRENCY", "currency"), ("LANGUAGE", "language")) if before["settings"].get(key)],
        },
        "removed": removed,
        "notes": notes,
        "checked": ["transactions", "rules", "categories", "tags", "currencies", "settings", "integrity"],
    }

def _n(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"

def text(r: dict) -> str:
    """The report as plain text, for the data folder and the command line."""
    k = r["kept"]
    kept_settings = [f"the {name}" for name in k.get("settings", [])] + (["the household password"] if k["password"] else [])
    lines = [
        f"Wally {r['to']}: upgrade from {r['from']} on {r['at'][:10]}",
        "",
        "Kept, and checked one by one against the old database:",
        "  " + _n(k["transactions"], "transaction", "transactions") + (f", from {k['first']} to {k['last']}" if k["first"] else ""),
        f"  spent {k['expense']}, earned {k['income']}",
        "  " + ", ".join([_n(k["rules"], "recurring rule", "recurring rules"), _n(k["categories"], "category", "categories"), _n(k["tags"], "tag", "tags")]),
    ]
    if kept_settings:
        lines.append("  " + (", ".join(kept_settings[:-1]) + " and " + kept_settings[-1] if len(kept_settings) > 1 else kept_settings[0]))
    if r["removed"]:
        lines += ["", f"Taken out: {len(r['removed'])} charges that 1.x added in advance, dated after {r['today']}.",
                  "Wally 2.0 adds each recurring charge on its day, so they come back then:"]
        lines += [f"  {x['date']}  {x['name']}  {x['amount']}" for x in r["removed"]]
    for n in r["notes"]:
        if n["kind"] == "decimals":
            lines += ["", (f"1 amount has more than two decimals, as typed in 1.x. It is kept as it is and shown to the cent:" if n["count"] == 1
                           else f"{n['count']} amounts have more than two decimals, as typed in 1.x. They are kept as they are and shown to the cent:")]
            lines += [f"  {x['date']}  {x['name']}  {x['amount']}" for x in n["examples"]]
        elif n["kind"] == "categories":
            lines += ["", ("1 category is used by transactions but was not in the category list. Wally 2.0 lists it: " if n["count"] == 1
                           else f"{n['count']} categories are used by transactions but were not in the category list. Wally 2.0 lists them: ") + ", ".join(n["examples"])]
    if r.get("backup"):
        lines += ["", f"A copy of the old database is in backups/{r['backup']}, in Wally's data folder.",
                  "To go back to 1.x, put that copy in place of wally.db and start the 1.x image."]
    return "\n".join(lines) + "\n"

def save(r: dict, data_dir: Path) -> Path:
    path = data_dir / f"upgrade-report-{r['at'][:10]}.txt"
    path.write_text(text(r), encoding="utf-8")
    (data_dir / f"upgrade-report-{r['at'][:10]}.json").write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
    return path

def check(path: Path) -> int:
    """Upgrade a copy of a database and print what would happen. The original is never opened for writing."""
    from . import database
    if not path.exists():
        print(f"No database at {path}.")
        return 2
    with tempfile.TemporaryDirectory() as folder:
        copy = Path(folder) / "wally.db"
        src = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        dst = sqlite3.connect(copy)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        database.configure(Path(folder))
        database.create_db_and_tables()
        if database.STATE["read_only"]:
            print("The upgrade would fail, and Wally would keep your data as it is:\n" + database.STATE["read_only"])
            return 1
        r = database.STATE.get("upgrade")
        if not r:
            print("This database is already up to date: nothing to upgrade.")
            return 0
        print(text({**r, "backup": None}), end="")
        print("\nThis was a check on a copy. Nothing was changed.")
        return 0

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--check"]
    if "--check" not in sys.argv[1:]:
        print(__doc__)
        sys.exit(2)
    from . import database
    sys.exit(check(Path(args[0]) if args else database.DB_PATH))
