"""Look inside a Wally database from outside the browser, for the browser tests (tests/e2e/vault.mjs).

    python tests/vault_check.py open  <wally.db> <password>               everything, opened with the household password
    python tests/vault_check.py plain <wally.db>                           everything in the clear (encryption off)
    python tests/vault_check.py grep  <wally.db> <word> [<word>...]        which words appear anywhere in the file

Prints JSON. Items are in the shape the browser seals, import rules without their ids.
"""
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

def main():
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == "open":
        from tests.vault_crypto import open_database
        _, items = open_database(path, sys.argv[3])
    elif cmd == "plain":
        from sqlmodel import Session
        from api import database
        from api.routers.vault import export_items
        engine = database.make_engine(Path(path))
        database.import_models()
        with Session(engine) as db:
            items = export_items(db)
    elif cmd == "grep":
        raw = Path(path).read_bytes()
        for extra in (Path(f"{path}-journal"), Path(f"{path}-wal")):
            if extra.exists():
                raw += extra.read_bytes()
        print(json.dumps({w: (w.encode() in raw) for w in sys.argv[3:]}))
        return
    else:
        raise SystemExit(__doc__)
    for i in items:
        if i["k"] == "irule":
            i.pop("id", None)
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        counts = {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in ("transaction", "recurringtransaction", "category", "tag", "importrule", "record")}
    finally:
        conn.close()
    print(json.dumps({"items": sorted(json.dumps(i, sort_keys=True, ensure_ascii=False) for i in items), "counts": counts}, ensure_ascii=False))

main()
