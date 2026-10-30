"""Copies of the database: nightly, by hand, and before an upgrade or a restore."""
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from fastapi import HTTPException
from sqlmodel import Session

from .. import database
from ..util import household_tz

KEEP_AUTOMATIC = 14
NAME = re.compile(r"^[A-Za-z0-9._-]+\.db$")

def _stamp(db: Session | None = None) -> str:
    return datetime.now(household_tz(db)).strftime("%Y-%m-%d-%H%M%S")

def list_backups() -> list[dict]:
    folder = database.BACKUP_DIR
    if not folder.exists():
        return []
    out = []
    for path in folder.glob("*.db"):
        stat = path.stat()
        kind = "auto" if path.name.startswith("auto-") else "upgrade" if path.name.startswith("pre-") else "restore" if path.name.startswith("before-restore-") else "manual"
        out.append({"name": path.name, "size": stat.st_size, "created": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"), "kind": kind})
    return sorted(out, key=lambda b: b["created"], reverse=True)

def create_backup(kind: str = "manual", db: Session | None = None) -> dict:
    target = database.BACKUP_DIR / f"{kind}-{_stamp(db)}.db"
    database.copy_database(database.DB_PATH, target)
    return next(b for b in list_backups() if b["name"] == target.name)

def nightly_backup(db: Session):
    from ..routers.auth import flag
    if not flag(db, "NIGHTLY_BACKUP"):
        return
    create_backup("auto", db)
    automatic = [b for b in list_backups() if b["kind"] == "auto"]
    for old in automatic[KEEP_AUTOMATIC:]:
        (database.BACKUP_DIR / old["name"]).unlink(missing_ok=True)

def backup_path(name: str) -> Path:
    if not NAME.match(name):
        raise HTTPException(status_code=400, detail="Not a backup name.")
    path = database.BACKUP_DIR / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="This backup does not exist.")
    return path

def check_wally_database(path: Path):
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            conn.close()
    except sqlite3.DatabaseError:
        raise HTTPException(status_code=400, detail="This file is not a Wally backup.")
    if not {"transaction", "category", "appconfig"} <= tables:
        raise HTTPException(status_code=400, detail="This file is not a Wally backup.")

def restore(path: Path) -> dict:
    """Put a backup in place of the current database. The current one is kept as a backup first."""
    check_wally_database(path)
    safety = create_backup("before-restore")
    database.engine.dispose()
    for suffix in ("-wal", "-shm"):
        Path(f"{database.DB_PATH}{suffix}").unlink(missing_ok=True)
    database.copy_database(path, database.DB_PATH)
    # An older backup is brought up to date the same way an upgrade is
    database.migrate_db()
    return {"restored": path.name, "previous": safety["name"]}
