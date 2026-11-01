"""Turning encryption on or off: a new database file, switched to only once it is checked.

    1. Pause    the household is read-only for a minute; other devices say who is converting
    2. Build    wally.next.db, next to wally.db, which is not touched
    3. Check    the browser reads everything back and compares; SQLite checks the file
    4. Switch   wally.db becomes wally.prev.db, wally.next.db becomes wally.db (renames are atomic)
    5. Clean up turning on: the old file and plain backups go; turning off: the old file is kept as a backup

conversion.json, next to the database, says which step it is at. If Wally stops half-way, it
reads it on start: before the switch, the new file is thrown away and nothing changed; during
the switch or clean-up, it finishes them. So wally.db is always either the old file, untouched,
or the new one, checked.
"""
import json
import logging
import os
import secrets
import shutil
import sqlite3
import time
from pathlib import Path
from fastapi import HTTPException
from sqlmodel import SQLModel, Session, select

from .. import database
from ..models.app import AppConfig

log = logging.getLogger("wally")

# Two minutes without a word from the converting browser and the half-built file is thrown away
PAUSE_SECONDS = int(os.getenv("WALLY_PAUSE_SECONDS", "120"))
# Copied to the new file either way: who is here, how they sign in, the household's settings
KEEP = ["person", "sessiontoken", "appconfig", "currency", "kdf"]
# The household's data in the clear
PLAIN = ["transaction", "recurringtransaction", "category", "categorycolor", "tag", "importrule"]
VAULT_CONFIG = ("VAULT_ID", "VAULT_SEQ", "VAULT_FLOOR")

_next_engine = None

def journal_path() -> Path:
    return database.DATA_DIR / "conversion.json"

def next_path() -> Path:
    return database.DATA_DIR / "wally.next.db"

def prev_path() -> Path:
    return database.DATA_DIR / "wally.prev.db"

def read_journal() -> dict | None:
    try:
        return json.loads(journal_path().read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except ValueError:
        # A journal cut short by a crash was being written before any step it names happened
        log.warning("Unreadable conversion journal: treated as a conversion that never started")
        return {"step": "build"}

def write_journal(data: dict):
    """Written to a temporary file, flushed to disk, then renamed over the old one: never half written."""
    path = journal_path()
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as out:
        json.dump(data, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, path)
    _sync_dir()

def _sync_dir():
    try:
        fd = os.open(database.DATA_DIR, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass

def _remove(path: Path):
    for p in (path, Path(f"{path}-journal"), Path(f"{path}-wal"), Path(f"{path}-shm")):
        p.unlink(missing_ok=True)

def next_engine():
    global _next_engine
    if _next_engine is None:
        _next_engine = database.make_engine(next_path())
    return _next_engine

def _close_next():
    global _next_engine
    if _next_engine is not None:
        _next_engine.dispose()
        _next_engine = None

# ---------- the pause ----------
def current() -> dict | None:
    return database.STATE.get("conversion")

def touch():
    c = current()
    if c:
        c["until"] = time.time() + PAUSE_SECONDS

def check_expired():
    """A tab closed or a connection lost: after two minutes without a word, the half-built file goes."""
    c = current()
    if c and c.get("step") == "build" and time.time() > c["until"]:
        log.warning("Conversion %s stopped hearing from the browser: discarding the new file", c["id"])
        abort()

def require(conversion_id: str, person_id: int | None) -> dict:
    check_expired()
    c = current()
    if not c or c["id"] != conversion_id:
        raise HTTPException(status_code=409, detail="This conversion was stopped. Nothing changed. Try again.")
    if c["by"] != person_id:
        raise HTTPException(status_code=403, detail="Someone else is converting Wally.")
    touch()
    return c

def paused_detail() -> dict | None:
    c = current()
    if not c:
        return None
    return {"by": c["by_name"], "direction": c["direction"]}

# ---------- 1 and 2: pause and build ----------
def start(direction: str, person_id: int, person_name: str) -> dict:
    check_expired()
    if current() or read_journal():
        raise HTTPException(status_code=409, detail="Wally is already being converted. Try again in a minute.")
    db_size = database.DB_PATH.stat().st_size if database.DB_PATH.exists() else 0
    free = shutil.disk_usage(database.DATA_DIR).free
    need = db_size * 3 + 20 * 1024 * 1024
    if free < need:
        raise HTTPException(status_code=507, detail=f"Not enough disk space: Wally needs about {need // 1048576} MB free next to its database, and there are {free // 1048576} MB.")

    conversion = {"id": secrets.token_hex(16), "direction": direction, "step": "build", "by": person_id, "by_name": person_name, "started": time.time()}
    write_journal({k: conversion[k] for k in ("id", "direction", "step", "by", "started")})
    conversion["until"] = time.time() + PAUSE_SECONDS
    database.STATE["conversion"] = conversion
    try:
        # Changes already on their way when the pause began land before anything is copied
        _drain()
        _build_next(direction)
    except Exception:
        abort()
        raise
    return conversion

def _build_next(direction: str):
    _close_next()
    _remove(next_path())
    database.import_models()
    engine = next_engine()
    SQLModel.metadata.create_all(engine)
    _close_next()
    # The same tables, columns copied by name: a database upgraded from 1.x may order them differently
    conn = sqlite3.connect(next_path(), isolation_level=None)
    try:
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("ATTACH DATABASE ? AS old", (str(database.DB_PATH),))
        conn.execute("BEGIN")
        for table in KEEP:
            old_cols = {r[1] for r in conn.execute(f'PRAGMA old.table_info("{table}")').fetchall()}
            if not old_cols:
                continue
            cols = [r[1] for r in conn.execute(f'PRAGMA main.table_info("{table}")').fetchall() if r[1] in old_cols]
            names = ", ".join(f'"{c}"' for c in cols)
            conn.execute(f'INSERT INTO main."{table}" ({names}) SELECT {names} FROM old."{table}"')
        conn.execute("DELETE FROM main.appconfig WHERE key IN ('VAULT_ID', 'VAULT_SEQ', 'VAULT_FLOOR', 'ENCRYPTION_OFF')")
        conn.execute("COMMIT")
        conn.execute("DETACH DATABASE old")
    finally:
        conn.close()

def next_session() -> Session:
    return Session(next_engine())

# ---------- 3 and 4: check, then switch ----------
def integrity_ok(path: Path) -> bool:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        conn.close()

def switch(conversion: dict):
    """Put the new file in place of the old. Only called once the browser and SQLite checked it.
    No other request runs meanwhile: new ones wait for it, and it waits for those already running."""
    _close_next()
    database.STATE["switching"] = True
    try:
        _drain()
        _switch(conversion)
    finally:
        database.STATE.pop("switching", None)

def _drain(timeout: float = 15):
    end = time.time() + timeout
    while database.STATE.get("inflight", 0) > 1 and time.time() < end:
        time.sleep(0.02)

def _switch(conversion: dict):
    if not integrity_ok(next_path()):
        abort()
        raise HTTPException(status_code=500, detail="The new file did not pass SQLite’s check. Nothing changed.")
    database.engine.dispose()
    if not _settle(database.DB_PATH):
        abort()
        raise HTTPException(status_code=500, detail="wally.db was busy, so Wally did not switch. Nothing changed. Try again.")
    conversion["step"] = "switch"
    write_journal({k: conversion[k] for k in ("id", "direction", "step", "by", "started")})
    _do_switch()
    conversion["step"] = "cleanup"
    write_journal({k: conversion[k] for k in ("id", "direction", "step", "by", "started")})
    _cleanup(conversion["direction"])
    database.STATE.pop("conversion", None)
    _reload_state()

def _settle(db: Path) -> bool:
    """SQLite's rollback journal is named after the file. Opening the old file settles any journal
    left by a write that never finished, so none can follow the name to the new file."""
    if db.exists():
        conn = sqlite3.connect(db)
        try:
            conn.execute("PRAGMA schema_version").fetchone()
        finally:
            conn.close()
    return not Path(f"{db}-journal").exists() and not Path(f"{db}-wal").exists()

def _do_switch():
    database.engine.dispose()
    db, nxt, prev = database.DB_PATH, next_path(), prev_path()
    if nxt.exists():
        if db.exists():
            _settle(db)
            _remove(prev)
            os.replace(db, prev)
        os.replace(nxt, db)
        _sync_dir()
    database.engine = database.make_engine(db)

def _cleanup(direction: str):
    prev = prev_path()
    if direction == "on":
        # The old file holds everything in the clear, and so do backups made before
        _remove(prev)
        from .backups import plain_backups
        for path in plain_backups():
            path.unlink(missing_ok=True)
    elif prev.exists():
        from .backups import _stamp
        database.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        os.replace(prev, database.BACKUP_DIR / f"before-turning-off-encryption-{_stamp()}.db")
    _sync_dir()
    journal_path().unlink(missing_ok=True)

def _reload_state():
    from .vault import load_state
    with Session(database.engine) as db:
        load_state(db)

def abort():
    """Throw the new file away. wally.db was never touched."""
    _close_next()
    _remove(next_path())
    journal_path().unlink(missing_ok=True)
    database.STATE.pop("conversion", None)

# ---------- after a restart ----------
def recover_on_start():
    """Finish or undo a conversion that Wally stopped in the middle of."""
    j = read_journal()
    if not j:
        _remove(next_path())
        return
    step = j.get("step")
    log.warning("Wally stopped while %s encryption (step %s): %s", "turning on" if j.get("direction") == "on" else "turning off", step,
                "finishing it" if step in ("switch", "cleanup") else "discarding the new file, nothing changed")
    if step == "switch":
        _do_switch()
        step = "cleanup"
        write_journal({**j, "step": "cleanup"})
    if step == "cleanup":
        _cleanup(j.get("direction", "on"))
        return
    abort()
