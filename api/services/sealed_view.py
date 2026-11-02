"""API keys on an encrypted household: one API, whether Wally is encrypted or not.

An API key made while Wally is encrypted carries a secret that opens the household key (see
sealing.py). For a call that uses the household's data, the server:

    1. Opens   checks the key, opens the household key with it, and opens every record
    2. Builds  the same tables as an unencrypted Wally, as TEMP tables on this call's own database
               connection: SQLite looks there first, so the routers run unchanged
    3. Runs    the call
    4. Seals   for a change, what it changed, and saves it as a browser would (services/vault.py):
               all or nothing, and refused if a browser changed the same record meanwhile
    5. Forgets closes the connection, which drops the tables. Nothing opened is kept.

So while a call runs, the server holds the household key. Stored data stays encrypted, and a
stolen disk or backup opens nothing. Settings › API keys says so when a key is made.
"""
import asyncio
import json
import logging
import secrets

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from sqlalchemy.schema import CreateTable
from sqlmodel import Session, SQLModel, select

from .. import database
from ..models.vault import Record
from . import sealing, vault as records
from .conversion import PLAIN
from .engine import OCCURRENCE_ID

log = logging.getLogger("wally")

READS = ("GET", "HEAD", "OPTIONS")
# One call that changes data at a time; browsers' saves wait on records.WRITE_LOCK as usual
_writing = asyncio.Lock()

class View:
    def __init__(self, actor, household: sealing.Household):
        self.actor = actor
        self.hh = household
        self.conn = None
        self.loaded = {}   # record id → (version, the record as stored)
        self.gone = {}     # record id → version, for records deleted before
        self.names = {}    # (kind, name) → record id, for categories and tags
        self.irules = {}   # an import rule's number in its table → record id
        self.before = None
        self.broken = 0

    def session(self) -> Session:
        # Each session commits and rolls back this connection's transaction as if it were its own
        return Session(bind=self.conn, join_transaction_mode="control_fully")

    # ---------- 1 and 2 ----------
    def load(self, changes: bool):
        from ..routers.vault import export_items, import_item
        self.conn = database.engine.connect()
        for name in PLAIN:
            ddl = str(CreateTable(SQLModel.metadata.tables[name]).compile(dialect=self.conn.dialect)).strip()
            self.conn.exec_driver_sql(ddl.replace("CREATE TABLE", "CREATE TEMP TABLE", 1))
        self.conn.commit()
        with self.session() as db:
            rows = _Rows()
            for r in db.exec(select(Record)).all():
                if r.deleted or r.ct is None:
                    self.gone[r.id] = r.version
                    continue
                obj = self.hh.open(r.id, r.version, r.ct)
                kind = obj.get("k") if isinstance(obj, dict) else None
                if kind in ("cat", "tag"):
                    if (kind, obj.get("name")) in self.names:
                        continue
                    self.names[(kind, obj.get("name"))] = r.id
                try:
                    row = import_item(rows, dict(obj)) if kind else None
                except HTTPException:
                    row = None
                if row is None:
                    # Changed by someone without the key, as the browsers show it: left out, never dropped
                    self.broken += 1
                    continue
                self.loaded[r.id] = (r.version, obj)
                if kind == "irule":
                    row.id = len(self.irules) + 1
                    self.irules[row.id] = r.id
            # In bulk, table by table: much faster than adding rows one at a time
            for table, objs in rows.by_table().items():
                cols = [c.name for c in table.columns]
                db.execute(table.insert(), [{c: getattr(o, c) for c in cols} for o in objs])
            db.commit()
            if changes:
                self.before = self._keyed(export_items(db))
        if self.broken:
            log.warning("API key: %s records would not open and were left out", self.broken)

    def _keyed(self, items: list[dict]) -> dict:
        """Each item under its record id, as js/vault/session.js gives them"""
        out = {}
        for it in items:
            kind = it["k"]
            if kind in ("tx", "rule"):
                rid = it["id"].replace("-", "").lower()
            elif kind in ("cat", "tag"):
                rid = self.names.get((kind, it["name"])) or self.hh.id_for(f"{kind}|{it['name']}")
            else:
                number = int(it["id"])
                rid = self.irules.get(number)
                if rid is None:
                    rid = self.irules[number] = secrets.token_hex(16)
                it["id"] = rid
            out[rid] = it
        return out

    # ---------- 4 ----------
    def save(self):
        from ..routers.vault import export_items
        with self.session() as db:
            after = self._keyed(export_items(db))
        ops = []
        for rid, item in after.items():
            old = self.before.get(rid)
            if old is not None and _stable(old) == _stable(item):
                continue
            if rid in self.loaded:
                version, stored = self.loaded[rid]
                # Fields this server doesn't know about stay as the browser saved them
                obj, base = {**stored, **item}, version
            else:
                obj, base = item, self.gone.get(rid, 0)
            ops.append({"id": rid, "base": base, "ct": self.hh.seal(rid, base + 1, obj)})
        for rid in self.before.keys() - after.keys():
            ops.append({"id": rid, "base": self.loaded[rid][0], "ct": None})
        if not ops:
            return
        with records.WRITE_LOCK:
            with self.session() as db:
                try:
                    records.apply_batch(db, ops)
                except records.Conflict:
                    db.rollback()
                    raise
                db.commit()

    # ---------- 5 ----------
    def close(self):
        if self.conn is not None:
            # Closing the connection itself, not handing it back to the pool, drops the TEMP tables
            self.conn.invalidate()
            self.conn.close()
            self.conn = None
        self.loaded = self.before = self.hh = None

class _Rows(list):
    """Stands in for a session: import_item adds its rows here, to be inserted in bulk"""
    def add(self, row):
        self.append(row)

    def by_table(self) -> dict:
        out = {}
        for row in self:
            out.setdefault(row.__table__, []).append(row)
        return out

def _stable(v) -> str:
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

def _open(raw_key: str, method: str):
    """The key's person and the household key it opens, or an HTTPException"""
    from ..routers.auth import find_key, key_actor
    if not records.api_keys_allowed():
        raise HTTPException(status_code=401, detail="API keys are off on this server.")
    with Session(database.engine) as db:
        ak = find_key(db, raw_key)
        if not ak:
            raise HTTPException(status_code=401, detail="Invalid API key")
        if (ak.scope or "write") == "read" and method not in READS:
            raise HTTPException(status_code=403, detail="This key can only read.")
        if not ak.wrap:
            raise HTTPException(status_code=401, detail="This key was made before Wally was encrypted. Make a new one in Settings › API keys.")
        secret = sealing.unlock_with_api_key(raw_key, ak.wrap, records.vault_id(db))
        if not secret:
            raise HTTPException(status_code=401, detail="This key no longer opens the household’s data. Make a new one in Settings › API keys.")
        return key_actor(ak), sealing.Household(secret)

async def serve(request, call_next, raw_key: str):
    """A call with an API key that uses an encrypted household's data"""
    changes = request.method not in READS
    try:
        actor, household = await run_in_threadpool(_open, raw_key, request.method)
    except HTTPException as error:
        return JSONResponse({"detail": error.detail}, status_code=error.status_code)
    view = View(actor, household)
    lock = _writing if changes else None
    if lock:
        await lock.acquire()
    token = OCCURRENCE_ID.set(lambda rule_id, on: household.occurrence_id(rule_id, on))
    try:
        await run_in_threadpool(view.load, changes)
        request.state.view = view
        response = await call_next(request)
        body = b"".join([chunk async for chunk in response.body_iterator])
        if changes and response.status_code < 400:
            try:
                await run_in_threadpool(view.save)
            except records.Conflict:
                return JSONResponse({"detail": "Changed on another device at the same moment. Try again."}, status_code=409)
            except HTTPException as error:
                return JSONResponse({"detail": error.detail}, status_code=error.status_code)
        headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
        return Response(content=body, status_code=response.status_code, headers=headers, media_type=response.media_type)
    finally:
        OCCURRENCE_ID.reset(token)
        request.state.view = None
        await run_in_threadpool(view.close)
        if lock:
            lock.release()
