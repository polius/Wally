"""The sealed records: atomic batches with versions, the changes since a point, and old tombstones.

Every batch of changes is all or nothing. Each change names the version it was made from; if the
record moved on meanwhile (another device saved first), nothing in the batch is saved and the
browser is told which records changed, so it can merge and try again. The server never opens a
record: it only checks ids, versions and sizes.
"""
import base64
import os
import re
import threading
from datetime import timedelta
from fastapi import HTTPException
from sqlmodel import Session, select, func

from ..database import STATE
from ..models.app import AppConfig
from ..models.vault import Record
from ..util import utcnow

# Writes to the records happen one at a time, so the household counter never repeats
WRITE_LOCK = threading.RLock()

ID = re.compile(r"^[0-9a-f]{32}$")
MAX_RECORD = 64 * 1024          # bytes of one sealed record
MAX_BATCH = 20000               # changes in one batch
TOMBSTONE_DAYS = 180

class Conflict(Exception):
    def __init__(self, records: list[Record]):
        self.records = records

def _config(db: Session, key: str, default: str = "") -> str:
    row = db.get(AppConfig, key)
    return row.value if row else default

def _set(db: Session, key: str, value):
    row = db.get(AppConfig, key)
    if row:
        row.value = str(value)
    else:
        row = AppConfig(key=key, value=str(value))
    db.add(row)

def vault_id(db: Session) -> str | None:
    return _config(db, "VAULT_ID") or None

def is_on() -> bool:
    return bool(STATE.get("vault"))

def required() -> bool:
    """WALLY_ENCRYPTION=required: whoever runs the server promises it can't read anyone's data.
    New households are encrypted at setup, and encryption can't be turned off. Not in demo mode,
    which is sample data made in the clear."""
    return os.getenv("WALLY_ENCRYPTION", "").strip().lower() == "required" and os.getenv("DEMO", "false").lower() != "true"

def load_state(db: Session):
    """Remember whether encryption is on, so every request can check it without reading the database."""
    STATE["vault"] = vault_id(db)

def b64decode(value: str, what: str = "data") -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"Not valid {what}.")

def public(r: Record) -> dict:
    return {"id": r.id, "v": r.version, "seq": r.seq, "ct": None if r.deleted or r.ct is None else base64.b64encode(r.ct).decode()}

def check_op(op: dict):
    if not isinstance(op, dict) or not ID.match(str(op.get("id", ""))):
        raise HTTPException(status_code=400, detail="A record id is 32 hexadecimal characters.")
    base = op.get("base", 0)
    if not isinstance(base, int) or base < 0:
        raise HTTPException(status_code=400, detail="A record's base version is a whole number.")
    ct = op.get("ct")
    if ct is not None:
        if not isinstance(ct, str):
            raise HTTPException(status_code=400, detail="Not a sealed record.")
        raw = b64decode(ct, "sealed record")
        # At least a nonce, one padded block and the tag
        if not 12 + 64 + 16 <= len(raw) <= MAX_RECORD:
            raise HTTPException(status_code=400, detail="A sealed record has the wrong size.")
        op["_raw"] = raw

def apply_batch(db: Session, ops: list[dict]) -> dict:
    """Stage a batch in the session. The caller commits. Raises Conflict without staging anything
    when a record is not at the version a change was made from.

    Each op: {"id", "base": version it was made from (0: new), "ct": sealed record, or null to delete,
    "if_absent": true to skip quietly when the record exists, even deleted (two devices adding the
    same recurring charge)}."""
    if not isinstance(ops, list) or not ops:
        raise HTTPException(status_code=400, detail="Nothing to save.")
    if len(ops) > MAX_BATCH:
        raise HTTPException(status_code=400, detail=f"At most {MAX_BATCH} changes at once.")
    seen = set()
    for op in ops:
        check_op(op)
        if op["id"] in seen:
            raise HTTPException(status_code=400, detail="A record appears twice in one batch.")
        seen.add(op["id"])

    current = {}
    ids = list(seen)
    for i in range(0, len(ids), 500):
        for r in db.exec(select(Record).where(Record.id.in_(ids[i:i + 500]))).all():
            current[r.id] = r

    conflicts, writes, skipped = [], [], []
    for op in ops:
        cur = current.get(op["id"])
        if op.get("if_absent") and cur is not None:
            skipped.append(op["id"])
            continue
        have = cur.version if cur else 0
        if op.get("base", 0) != have:
            conflicts.append(cur if cur else Record(id=op["id"], version=0, seq=0, deleted=True))
            continue
        if op.get("ct") is None and (cur is None or cur.deleted):
            # Deleting what is already gone changes nothing
            skipped.append(op["id"])
            continue
        writes.append((op, cur))
    if conflicts:
        raise Conflict(conflicts)

    versions = {}
    if writes:
        seq = int(_config(db, "VAULT_SEQ", "0")) + 1
        _set(db, "VAULT_SEQ", seq)
        now = utcnow()
        for op, cur in writes:
            row = cur or Record(id=op["id"], version=0, seq=seq)
            row.version = (cur.version if cur else 0) + 1
            row.seq = seq
            row.updated_at = now
            if op.get("ct") is None:
                row.deleted, row.ct = True, None
            else:
                row.deleted, row.ct = False, op["_raw"]
            db.add(row)
            versions[op["id"]] = row.version
    else:
        seq = int(_config(db, "VAULT_SEQ", "0"))
    return {"seq": seq, "versions": versions, "skipped": skipped}

def conflict_response(error: Conflict) -> dict:
    return {"message": "Changed on another device.", "conflicts": [public(r) for r in error.records]}

def changes(db: Session, since: int) -> dict:
    floor = int(_config(db, "VAULT_FLOOR", "0"))
    if 0 < since < floor:
        raise HTTPException(status_code=410, detail="Too long since this device was last here. Download everything again.")
    rows = db.exec(select(Record).where(Record.seq > since).order_by(Record.seq, Record.id)).all()
    seq = int(_config(db, "VAULT_SEQ", "0"))
    # A full download needs no tombstones: the device starts from nothing
    out = [public(r) for r in rows if not (since == 0 and r.deleted)]
    return {"vault_id": vault_id(db), "seq": seq, "floor": floor, "records": out}

def purge_tombstones(db: Session, days: int = TOMBSTONE_DAYS) -> int:
    """Forget deletions older than 180 days. A device away longer than that downloads everything again."""
    limit = utcnow() - timedelta(days=days)
    old = db.exec(select(Record).where(Record.deleted == True).where(Record.updated_at < limit)).all()  # noqa: E712
    if not old:
        return 0
    with WRITE_LOCK:
        floor = max(int(_config(db, "VAULT_FLOOR", "0")), max(r.seq for r in old))
        for r in old:
            db.delete(r)
        _set(db, "VAULT_FLOOR", floor)
        db.commit()
    return len(old)

def live_count(db: Session) -> int:
    return db.exec(select(func.count()).select_from(Record).where(Record.deleted == False)).one()  # noqa: E712
