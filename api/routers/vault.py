"""End-to-end encryption: the household key, sealed records, getting back in, and turning it on or off.

Everything is opened and closed in the browser. The server checks who is asking and keeps what
it is given; it cannot read the password, a key or a figure. There is one household key, locked
under the household password and under the recovery key of the household's Emergency Kit.
"""
import json
import logging
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, select, func

from .. import database
from ..database import get_session
from ..models.app import AppConfig
from ..models.categories import Category, CategoryColor, CategoryIcon
from ..models.money import ImportRule
from ..models.people import Person
from ..models.recurring_transactions import RecurringTransaction
from ..models.tags import Tag
from ..models.transactions import Transaction
from ..models.vault import HouseholdKey, Record
from ..services import conversion, vault as records
from ..services.backups import plain_rows, plain_backups
from ..util import utcnow, to_cents, from_cents
from .auth import (
    Actor, check_login, config, flag, set_config, hash_password, prove_password, password_salt,
)

router = APIRouter(tags=["Encryption"])
log = logging.getLogger("wally")

EVENT_DAYS = 30

HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX32 = re.compile(r"^[0-9a-f]{32}$")

# ---------- checks ----------
def _hex64(value: str | None, what: str) -> str:
    if not value or not HEX64.match(value):
        raise HTTPException(status_code=400, detail=f"Not a valid {what}.")
    return value

def _salt(value: str | None) -> str:
    if not value or len(records.b64decode(value, "salt")) != 16:
        raise HTTPException(status_code=400, detail="Not a valid salt.")
    return value

def _wrap(value: str | None) -> str:
    # A nonce, the 32-byte key and the tag
    if not value or len(records.b64decode(value, "locked key")) != 12 + 32 + 16:
        raise HTTPException(status_code=400, detail="Not a valid locked key.")
    return value

def _need_on(db: Session):
    if not records.vault_id(db):
        raise HTTPException(status_code=409, detail="Encryption is off.")

def _person(db: Session, person_id: int) -> Person:
    person = db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="This person does not exist.")
    return person

def _key(db: Session) -> HouseholdKey:
    key = db.get(HouseholdKey, 1)
    if not key:
        raise HTTPException(status_code=409, detail="This household has no key.")
    return key

def signed_in(actor: Actor = Depends(check_login)) -> Actor:
    """Keys and records are only for someone signed in on this browser, never an API key."""
    if actor.via != "session" or actor.person_id is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return actor

def vault_status(db: Session) -> dict:
    """What /auth/status says about encryption."""
    vid = records.vault_id(db)
    out = {"on": bool(vid), "id": vid, "paused": conversion.paused_detail(), "required": records.required(), "kdf": bool(password_salt(db)),
           "api_keys": records.api_keys_allowed()}
    if not vid:
        try:
            off = json.loads(config(db, "ENCRYPTION_OFF") or "null")
            if off and utcnow() - datetime.fromisoformat(off["at"]) < timedelta(days=EVENT_DAYS):
                out["turned_off"] = off
        except (ValueError, KeyError, TypeError):
            pass
    return out

# ---------- signing in: the salt, then the locked key ----------
@router.get("/vault/kdf")
def read_kdf(
    db: Annotated[Session, Depends(get_session)],
):
    """The salt the browser turns the household password into keys with, if there is one."""
    return {"salt": password_salt(db) or None, "state": "key" if records.vault_id(db) else "plain"}

@router.get("/vault/key")
def read_key(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """The household key, locked under the password. Only a browser that knows the password can unlock it."""
    _need_on(db)
    key = _key(db)
    return {"vault_id": records.vault_id(db), "salt": password_salt(db), "wrap": key.wrap, "recovery_made": key.recovery_made}

# ---------- records ----------
@router.get("/vault/changes")
def read_changes(
    db: Annotated[Session, Depends(get_session)],
    since: int = 0,
    actor: Actor = Depends(signed_in),
):
    """Every sealed record changed after `since` (the counter this device last saw); 0 for all of them."""
    _need_on(db)
    body = records.changes(db, max(0, since))
    return Response(content=_dumps(body), media_type="application/json")

def _dumps(body) -> str:
    return json.dumps(body, separators=(",", ":"))

class Batch(BaseModel):
    ops: list[dict]

@router.post("/vault/batch")
def write_batch(
    body: Batch,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """Save sealed records, all or none. 409 lists the records another device changed first."""
    _need_on(db)
    with records.WRITE_LOCK:
        try:
            result = records.apply_batch(db, body.ops)
        except records.Conflict as error:
            db.rollback()
            raise HTTPException(status_code=409, detail=records.conflict_response(error))
        db.commit()
    return result

# ---------- what the server still holds in the clear ----------
@router.get("/vault/check")
def check_server(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """With encryption on: anything left in the clear, in Wally's database or its backups."""
    _need_on(db)
    return {
        "plain_rows": plain_rows(database.DB_PATH),
        "plain_backups": [p.name for p in plain_backups()],
        "leftover_files": [p.name for p in (conversion.prev_path(), conversion.next_path()) if p.exists()],
        "records": records.live_count(db),
    }

# ---------- turning it on or off ----------
class Start(BaseModel):
    direction: Literal["on", "off"]
    current: str
    vault_id: str | None = None
    salt: str | None = None
    login_key: str | None = None
    wrap: str | None = None
    recovery_login: str | None = None
    recovery_wrap: str | None = None

@router.post("/vault/convert/start")
def convert_start(
    body: Start,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """Pause the household and build the new file. Turning on: the household key, locked under the
    password and the new Emergency Kit, goes in it now; the records follow from your browser."""
    me = _person(db, actor.person_id)
    on = bool(records.vault_id(db))
    if body.direction == "on" and on:
        raise HTTPException(status_code=409, detail="Encryption is already on.")
    if body.direction == "off" and not on:
        raise HTTPException(status_code=409, detail="Encryption is already off.")
    if body.direction == "off" and records.required():
        raise HTTPException(status_code=403, detail="This server keeps every household encrypted, so it can’t be turned off.")
    if not flag(db, "LOGIN_PAGE"):
        raise HTTPException(status_code=400, detail="Turn on sign-in first: the household password is the key to encryption.")
    prove_password(db, body.current)
    if body.direction == "on":
        if not body.vault_id or not HEX32.match(body.vault_id):
            raise HTTPException(status_code=400, detail="Not a valid vault id.")
        salt, login, wrap = _salt(body.salt), _hex64(body.login_key, "login key"), _wrap(body.wrap)
        rec_login, rec_wrap = _hex64(body.recovery_login, "recovery key"), _wrap(body.recovery_wrap)

    c = conversion.start(body.direction, me.id, me.name)
    try:
        with conversion.next_session() as nx:
            if body.direction == "on":
                for key, value in (("VAULT_ID", body.vault_id), ("VAULT_SEQ", 0), ("VAULT_FLOOR", 0)):
                    nx.add(AppConfig(key=key, value=str(value)))
                set_config(nx, "LOGIN_SALT", salt)
                set_config(nx, "LOGIN_PASSWORD", hash_password(login))
                # The new Emergency Kit replaces the one made without encryption
                set_config(nx, "KIT_HASH", "")
                set_config(nx, "KIT_MADE", "")
                nx.add(HouseholdKey(wrap=wrap, recovery_hash=hash_password(rec_login), recovery_wrap=rec_wrap, recovery_made=utcnow()))
            nx.commit()
    except Exception:
        conversion.abort()
        raise
    return {"id": c["id"], "pause_seconds": conversion.PAUSE_SECONDS}

def _fmt(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.strftime("%Y-%m-%dT%H:%M:%S.%f")

def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    # Stored in UTC, as utcnow() writes it
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

def export_items(db: Session) -> list[dict]:
    """Every piece of the household's data in the clear, in the shape the browser seals."""
    out = []
    for t in db.exec(select(Transaction)).all():
        out.append({
            "k": "tx", "id": str(t.id), "name": t.name, "category": t.category, "tags": list(t.tags or []), "cents": to_cents(t.amount),
            "type": t.type, "date": t.date.isoformat(), "person_id": t.person_id, "shares": t.shares or None, "paid_by": t.paid_by,
            "note": t.note or "", "recurringID": t.recurringID or "", "created_date": _fmt(t.created_date), "created_by": t.created_by,
            "import_ref": t.import_ref, "source": t.source or None, "group_id": t.group_id,
        })
    for r in db.exec(select(RecurringTransaction)).all():
        out.append({
            "k": "rule", "id": str(r.id), "name": r.name, "category": r.category, "tags": list(r.tags or []), "cents": to_cents(r.amount),
            "type": r.type, "startDate": r.startDate.isoformat(), "endDate": r.endDate.isoformat() if r.endDate else None,
            "frequency": r.frequency, "interval": r.interval or 1, "person_id": r.person_id, "shares": r.shares or None, "paid_by": r.paid_by,
            "about": bool(r.about), "note": r.note or "", "paused": bool(r.paused), "last_run": r.last_run.isoformat() if r.last_run else None,
            "anchor_day": r.anchor_day, "missed": r.missed or None, "created_date": _fmt(r.created_date),
        })
    colors = {c.name: c.color for c in db.exec(select(CategoryColor)).all()}
    icons = {c.name: c.icon for c in db.exec(select(CategoryIcon)).all()}
    for c in db.exec(select(Category)).all():
        item = {"k": "cat", "name": c.name, "color": colors.get(c.name)}
        if icons.get(c.name):
            item["icon"] = icons[c.name]
        out.append(item)
    for g in db.exec(select(Tag)).all():
        out.append({"k": "tag", "name": g.name})
    for i in db.exec(select(ImportRule)).all():
        out.append({
            "k": "irule", "id": str(i.id), "match": i.match, "category": i.category, "person_id": i.person_id, "set_person": bool(i.set_person),
            "uses": i.uses, "learned": bool(i.learned), "position": i.position, "created_at": _fmt(i.created_at),
        })
    return out

@router.get("/vault/convert/export")
def convert_export(
    id: str,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """Turning on: everything in the clear, once, for your browser to seal."""
    c = conversion.require(id, actor.person_id)
    if c["direction"] != "on":
        raise HTTPException(status_code=400, detail="Only when turning encryption on.")
    return Response(content=_dumps({"items": export_items(db)}), media_type="application/json")

class SealedIn(BaseModel):
    id: str
    records: list[dict]

@router.post("/vault/convert/records")
def convert_records(
    body: SealedIn,
    actor: Actor = Depends(signed_in),
):
    """Turning on: sealed records, in batches, into the new file."""
    c = conversion.require(body.id, actor.person_id)
    if c["direction"] != "on":
        raise HTTPException(status_code=400, detail="Only when turning encryption on.")
    with conversion.next_session() as nx:
        ops = [{"id": r.get("id"), "base": 0, "ct": r.get("ct")} for r in body.records]
        for op in ops:
            records.check_op(op)
            if op.get("ct") is None:
                raise HTTPException(status_code=400, detail="Not a sealed record.")
        ids = [op["id"] for op in ops]
        if len(set(ids)) != len(ids) or nx.exec(select(func.count()).select_from(Record).where(Record.id.in_(ids))).one():
            raise HTTPException(status_code=400, detail="A record was sent twice.")
        now = utcnow()
        for op in ops:
            nx.add(Record(id=op["id"], version=1, seq=1, ct=op["_raw"], updated_at=now))
        nx.commit()
        count = records.live_count(nx)
    return {"count": count}

class PlainIn(BaseModel):
    id: str
    items: list[dict]

def import_item(nx: Session, item: dict):
    """One opened record into its table. Returns the row added."""
    kind = item.get("k")
    try:
        if kind == "tx":
            cents = int(item["cents"])
            if cents <= 0:
                raise ValueError("amount")
            row = Transaction(
                id=UUID(item["id"]), name=item.get("name") or "", category=item["category"], tags=list(item.get("tags") or []),
                amount=from_cents(cents), type=item["type"], date=date.fromisoformat(item["date"]), person_id=item.get("person_id"),
                shares=item.get("shares") or None, paid_by=item.get("paid_by"), note=item.get("note") or "", recurringID=item.get("recurringID") or "",
                created_date=_parse_dt(item.get("created_date")) or utcnow(), created_by=item.get("created_by"), import_ref=item.get("import_ref"),
                source=item.get("source") or None, group_id=item.get("group_id"),
            )
        elif kind == "rule":
            row = RecurringTransaction(
                id=UUID(item["id"]), name=item.get("name") or "", category=item["category"], tags=list(item.get("tags") or []),
                amount=from_cents(int(item["cents"])), type=item["type"], startDate=date.fromisoformat(item["startDate"]),
                endDate=date.fromisoformat(item["endDate"]) if item.get("endDate") else None, frequency=item["frequency"],
                interval=int(item.get("interval") or 1), person_id=item.get("person_id"), shares=item.get("shares") or None,
                paid_by=item.get("paid_by"), about=bool(item.get("about")), note=item.get("note") or "", paused=bool(item.get("paused")),
                last_run=date.fromisoformat(item["last_run"]) if item.get("last_run") else None, anchor_day=item.get("anchor_day"),
                missed=item.get("missed") or None, created_date=_parse_dt(item.get("created_date")) or utcnow(),
            )
        elif kind == "cat":
            row = Category(name=item["name"])
            if item.get("color") is not None:
                nx.add(CategoryColor(name=item["name"], color=int(item["color"])))
            if item.get("icon"):
                nx.add(CategoryIcon(name=item["name"], icon=str(item["icon"])))
        elif kind == "tag":
            row = Tag(name=item["name"])
        elif kind == "irule":
            row = ImportRule(
                match=item["match"], category=item["category"], person_id=item.get("person_id"), set_person=bool(item.get("set_person", True)),
                uses=int(item.get("uses") or 0), learned=bool(item.get("learned")), position=int(item.get("position") or 0),
                created_at=_parse_dt(item.get("created_at")) or utcnow(),
            )
        else:
            raise ValueError("kind")
    except (KeyError, ValueError, TypeError) as error:
        raise HTTPException(status_code=400, detail=f"Not a valid {kind or 'item'}: {error}")
    nx.add(row)
    return row

@router.post("/vault/convert/plain")
def convert_plain(
    body: PlainIn,
    actor: Actor = Depends(signed_in),
):
    """Turning off: the household's data, opened by your browser, into the new file."""
    c = conversion.require(body.id, actor.person_id)
    if c["direction"] != "off":
        raise HTTPException(status_code=400, detail="Only when turning encryption off.")
    with conversion.next_session() as nx:
        for item in body.items:
            import_item(nx, item)
        try:
            nx.commit()
        except Exception as error:
            nx.rollback()
            log.warning("Turning encryption off: the new file refused a batch: %s", error)
            raise HTTPException(status_code=400, detail="Something was sent twice. Start again.")
    return {"ok": True}

@router.get("/vault/convert/readback")
def convert_readback(
    id: str,
    actor: Actor = Depends(signed_in),
):
    """Everything in the new file, for your browser to compare with what it sent."""
    c = conversion.require(id, actor.person_id)
    with conversion.next_session() as nx:
        if c["direction"] == "on":
            body = {"records": [records.public(r) for r in nx.exec(select(Record).order_by(Record.id)).all()]}
        else:
            body = {"items": export_items(nx)}
    return Response(content=_dumps(body), media_type="application/json")

class Finish(BaseModel):
    id: str
    count: int

def _plain_count(db: Session) -> int:
    return sum(db.exec(select(func.count()).select_from(m)).one() for m in (Transaction, RecurringTransaction, Category, Tag, ImportRule))

@router.post("/vault/convert/finish")
def convert_finish(
    body: Finish,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """Your browser compared everything: count once more, check the file, and switch."""
    c = conversion.require(body.id, actor.person_id)
    with conversion.next_session() as nx:
        if c["direction"] == "on":
            source, built = _plain_count(db), records.live_count(nx)
            # Every record arrived in the first batch
            row = nx.get(AppConfig, "VAULT_SEQ")
            row.value = "1"
            nx.add(row)
            nx.commit()
        else:
            source, built = records.live_count(db), _plain_count(nx)
            # Everyone sees who turned it off, for a month
            nx.add(AppConfig(key="ENCRYPTION_OFF", value=json.dumps({"by": actor.person_id, "at": utcnow().isoformat()})))
            nx.commit()
    if not source == built == body.count:
        conversion.abort()
        raise HTTPException(status_code=409, detail=f"The new file has {built} items and the old one {source}. Nothing changed.")
    db.close()
    conversion.switch(c)
    return {"ok": True, "direction": c["direction"]}

class Abort(BaseModel):
    id: str

@router.post("/vault/convert/abort")
def convert_abort(
    body: Abort,
    actor: Actor = Depends(signed_in),
):
    c = conversion.current()
    if c and c["id"] == body.id and c["by"] == actor.person_id and c.get("step") == "build":
        conversion.abort()
    return {"ok": True}
