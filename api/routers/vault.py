"""End-to-end encryption: keys, sealed records, getting back in, and turning it on or off.

Everything is opened and closed in the browser. The server checks who is asking and keeps what
it is given; it cannot read a password, a key or a figure.
"""
import json
import logging
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

import jwt
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlmodel import Session, select, delete, func

from .. import database
from ..database import get_session
from ..models.app import AppConfig
from ..models.categories import Category, CategoryColor
from ..models.money import ImportRule
from ..models.people import Person, SessionToken
from ..models.recurring_transactions import RecurringTransaction
from ..models.tags import Tag
from ..models.transactions import Transaction
from ..models.vault import Kdf, VaultKey, Invite, Record, VaultEvent
from ..services import conversion, vault as records
from ..services.backups import plain_rows, plain_backups
from ..util import utcnow, to_cents, from_cents
from .auth import (
    Actor, check_login, config, flag, set_config, hash_password, check_password, check_locked, record_failure,
    clear_failures, start_session, is_https, second_step, _aware, has_recovery_password,
)

router = APIRouter(tags=["Encryption"])
log = logging.getLogger("wally")

SETUP_COOKIE = "wally_setup"
SETUP_MINUTES = 15
INVITE_HOURS = 48
INVITE_TRIES = 3
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

def signed_in(actor: Actor = Depends(check_login)) -> Actor:
    """Keys and records are only for someone signed in on this browser, never an API key."""
    if actor.via != "session" or actor.person_id is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return actor

def _proof(db: Session, person: Person, value: str):
    """The person's login key, made from their password in the browser, for sensitive changes."""
    check_locked(person.id)
    if not person.password_hash or not check_password(value or "", person.password_hash):
        left = record_failure(person.id)
        raise HTTPException(status_code=401, detail={"message": "That password is not right.", "tries_left": left})
    clear_failures(person.id)

def _set_kdf(db: Session, person_id: int, salt: str):
    row = db.get(Kdf, person_id) or Kdf(person_id=person_id, salt=salt)
    row.salt = salt
    db.add(row)

def _purge_invites(db: Session):
    now = utcnow()
    for inv in db.exec(select(Invite)).all():
        if _aware(inv.expires_at) < now:
            db.delete(inv)

def vault_status(db: Session, me: Person | None) -> dict:
    """What /auth/status says about encryption."""
    vid = records.vault_id(db)
    out = {"on": bool(vid), "id": vid, "paused": conversion.paused_detail(), "required": records.required()}
    if not vid:
        out["kdf"] = bool(me and db.get(Kdf, me.id))
        try:
            off = json.loads(config(db, "ENCRYPTION_OFF") or "null")
            if off and utcnow() - datetime.fromisoformat(off["at"]) < timedelta(days=EVENT_DAYS):
                out["turned_off"] = off
        except (ValueError, KeyError, TypeError):
            pass
        return out
    keys = {k.person_id for k in db.exec(select(VaultKey)).all()}
    now = utcnow()
    invites = {i.person_id: i for i in db.exec(select(Invite)).all() if _aware(i.expires_at) >= now}
    out["kdf"] = bool(me and db.get(Kdf, me.id))
    out["mine"] = bool(me and me.id in keys)
    out["people"] = {str(p.id): {"key": p.id in keys, "invite": bool(invites.get(p.id))} for p in db.exec(select(Person)).all()}
    since = now - timedelta(days=EVENT_DAYS)
    out["events"] = [{"id": e.id, "kind": e.kind, "person_id": e.person_id, "by": e.by, "at": _aware(e.at).isoformat()}
                     for e in db.exec(select(VaultEvent).order_by(VaultEvent.at.desc())).all() if _aware(e.at) >= since]
    return out

# ---------- signing in: the salt, then the locked key ----------
@router.get("/vault/kdf")
def read_kdf(
    person_id: int,
    db: Annotated[Session, Depends(get_session)],
):
    """The salt the browser needs to turn a password into keys. With encryption on, also whether
    this person can unlock Wally yet ("key"), or has a code waiting ("invite")."""
    person = _person(db, person_id)
    row = db.get(Kdf, person_id)
    if not records.vault_id(db):
        return {"salt": row.salt if row else None, "state": "plain", "one_time": bool(row) and has_recovery_password(person.name)}
    if db.get(VaultKey, person_id):
        state = "key"
    else:
        inv = db.get(Invite, person_id)
        state = "invite" if inv and _aware(inv.expires_at) >= utcnow() else "none"
    return {"salt": row.salt if row else None, "state": state}

@router.get("/vault/key")
def read_key(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """Your household key, locked under your password. Only your browser can unlock it."""
    _need_on(db)
    key = db.get(VaultKey, actor.person_id)
    kdf = db.get(Kdf, actor.person_id)
    if not key or not kdf:
        raise HTTPException(status_code=404, detail="You have no key yet. Ask someone in the household for a code.")
    return {"vault_id": records.vault_id(db), "salt": kdf.salt, "wrap": key.wrap, "recovery_made": key.recovery_made}

# ---------- records ----------
def _keyholder(db: Session, actor: Actor):
    _need_on(db)
    if not db.get(VaultKey, actor.person_id):
        raise HTTPException(status_code=403, detail="You have no key yet. Ask someone in the household for a code.")

@router.get("/vault/changes")
def read_changes(
    db: Annotated[Session, Depends(get_session)],
    since: int = 0,
    actor: Actor = Depends(signed_in),
):
    """Every sealed record changed after `since` (the counter this device last saw); 0 for all of them."""
    _keyholder(db, actor)
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
    _keyholder(db, actor)
    with records.WRITE_LOCK:
        try:
            result = records.apply_batch(db, body.ops)
        except records.Conflict as error:
            db.rollback()
            raise HTTPException(status_code=409, detail=records.conflict_response(error))
        db.commit()
    return result

# ---------- the recovery key ----------
class RecoveryKey(BaseModel):
    current: str
    recovery_login: str
    recovery_wrap: str

@router.post("/vault/recovery-key")
def new_recovery_key(
    body: RecoveryKey,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """A new recovery key, for a new Emergency Kit. The old one stops working."""
    _need_on(db)
    me = _person(db, actor.person_id)
    _proof(db, me, body.current)
    key = db.get(VaultKey, me.id)
    if not key:
        raise HTTPException(status_code=404, detail="You have no key yet.")
    key.recovery_hash = hash_password(_hex64(body.recovery_login, "recovery key"))
    key.recovery_wrap = _wrap(body.recovery_wrap)
    key.recovery_made = utcnow()
    db.add(key)
    db.commit()
    return {"ok": True, "recovery_made": key.recovery_made}

# ---------- getting back in ----------
class Proof(BaseModel):
    person_id: int
    login: str
    code: str = ""
    recovery_code: str = ""

def _setup_cookie(db: Session, request: Request, response: Response, person_id: int, via: str):
    token = jwt.encode(
        {"sub": str(person_id), "purpose": "vault-setup", "via": via, "exp": datetime.now(timezone.utc) + timedelta(minutes=SETUP_MINUTES)},
        config(db, "SECRET_KEY"), algorithm="HS512",
    )
    response.set_cookie(SETUP_COOKIE, token, max_age=SETUP_MINUTES * 60, httponly=True, samesite="lax", secure=is_https(request), path="/")

def _two_step(db: Session, person: Person, body: Proof) -> dict | None:
    """With two-step on, the code is still needed: a recovery key or a code from someone replaces
    the password only. Returns {"code_needed": True} when it has not been typed yet."""
    if not person.totp_enabled:
        return None
    if not body.code and not body.recovery_code:
        return {"code_needed": True}
    if not second_step(db, person, body.code, body.recovery_code):
        left = record_failure(person.id)
        message = "That recovery code is not right, or it was already used." if body.recovery_code else "That code is not right. Codes change every 30 seconds."
        raise HTTPException(status_code=401, detail={"message": message, "tries_left": left, "second_step": True})
    return None

@router.post("/vault/recover")
def recover_with_key(
    body: Proof,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    """Back in with the recovery key from the Emergency Kit: then a new password."""
    _need_on(db)
    person = _person(db, body.person_id)
    check_locked(person.id)
    key = db.get(VaultKey, person.id)
    if not key or not key.recovery_hash or not check_password(body.login or "", key.recovery_hash):
        left = record_failure(person.id)
        raise HTTPException(status_code=401, detail={"message": "That recovery key is not right.", "tries_left": left})
    pending = _two_step(db, person, body)
    if pending:
        return pending
    clear_failures(person.id)
    db.commit()
    _setup_cookie(db, request, response, person.id, "recovery")
    return {"wrap": key.recovery_wrap, "vault_id": records.vault_id(db), "kind": "recovery"}

@router.post("/vault/redeem")
def redeem_code(
    body: Proof,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    """A one-use code from someone in the household: a first way in, or a way back in."""
    _need_on(db)
    person = _person(db, body.person_id)
    check_locked(person.id)
    inv = db.get(Invite, person.id)
    if not inv or _aware(inv.expires_at) < utcnow():
        if inv:
            db.delete(inv)
            db.commit()
        raise HTTPException(status_code=404, detail="This code expired or was cancelled. Ask for a new one.")
    if not check_password(body.login or "", inv.login_hash):
        inv.failures += 1
        if inv.failures >= INVITE_TRIES:
            db.delete(inv)
            db.commit()
            raise HTTPException(status_code=401, detail={"message": "Three wrong codes: this code was cancelled. Ask for a new one.", "tries_left": 0, "cancelled": True})
        db.add(inv)
        db.commit()
        raise HTTPException(status_code=401, detail={"message": "That code is not right.", "tries_left": INVITE_TRIES - inv.failures})
    pending = _two_step(db, person, body)
    if pending:
        return pending
    clear_failures(person.id)
    db.commit()
    _setup_cookie(db, request, response, person.id, "invite")
    return {"wrap": inv.wrap, "vault_id": records.vault_id(db), "kind": inv.kind}

class Setup(BaseModel):
    salt: str
    login_key: str
    wrap: str
    recovery_login: str | None = None
    recovery_wrap: str | None = None

@router.post("/vault/setup")
def finish_setup(
    body: Setup,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    """After a recovery key or a code: the new password's keys, and with a code, a new recovery key.
    Every other sign-in of this person ends."""
    _need_on(db)
    try:
        claims = jwt.decode(request.cookies.get(SETUP_COOKIE) or "", config(db, "SECRET_KEY"), algorithms=["HS512"])
        assert claims.get("purpose") == "vault-setup"
        person = db.get(Person, int(claims["sub"]))
        assert person
    except Exception:
        raise HTTPException(status_code=401, detail="That took too long. Start again.")
    via = claims.get("via")
    salt, login, wrap = _salt(body.salt), _hex64(body.login_key, "login key"), _wrap(body.wrap)
    inv = None
    if via == "invite":
        inv = db.get(Invite, person.id)
        if not inv:
            raise HTTPException(status_code=409, detail="This code was cancelled meanwhile. Ask for a new one.")
        if not body.recovery_login or not body.recovery_wrap:
            raise HTTPException(status_code=400, detail="A new Emergency Kit is needed.")
    _set_kdf(db, person.id, salt)
    person.password_hash = hash_password(login)
    person.must_change_password = False
    db.add(person)
    key = db.get(VaultKey, person.id) or VaultKey(person_id=person.id, wrap=wrap)
    key.wrap = wrap
    if body.recovery_login or body.recovery_wrap:
        key.recovery_hash = hash_password(_hex64(body.recovery_login, "recovery key"))
        key.recovery_wrap = _wrap(body.recovery_wrap)
        key.recovery_made = utcnow()
    db.add(key)
    if inv:
        if inv.kind == "help":
            db.add(VaultEvent(kind="helped", person_id=person.id, by=inv.created_by))
        db.delete(inv)
    # A new password: every device of this person signs in again
    db.exec(delete(SessionToken).where(SessionToken.person_id == person.id))
    start_session(db, request, response, person.id)
    response.delete_cookie(SETUP_COOKIE, path="/")
    db.commit()
    return {"ok": True}

# ---------- codes for someone else ----------
class NewInvite(BaseModel):
    person_id: int
    current: str
    login: str
    wrap: str

@router.get("/vault/invites")
def list_invites(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    _need_on(db)
    _purge_invites(db)
    db.commit()
    return [{"person_id": i.person_id, "kind": i.kind, "created_by": i.created_by, "created_at": _aware(i.created_at).isoformat(), "expires_at": _aware(i.expires_at).isoformat()}
            for i in db.exec(select(Invite)).all()]

@router.post("/vault/invites")
def create_invite(
    body: NewInvite,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """Lock the household key under a code for one person, for 48 hours. Made only when asked,
    never in advance; a new code replaces the old one."""
    _keyholder(db, actor)
    me = _person(db, actor.person_id)
    _proof(db, me, body.current)
    target = _person(db, body.person_id)
    if target.id == me.id:
        raise HTTPException(status_code=400, detail="Use your recovery key to get yourself back in.")
    kind = "help" if db.get(VaultKey, target.id) else "invite"
    inv = db.get(Invite, target.id) or Invite(person_id=target.id, kind=kind, login_hash="", wrap="", expires_at=utcnow())
    inv.kind = kind
    inv.login_hash = hash_password(_hex64(body.login, "code"))
    inv.wrap = _wrap(body.wrap)
    inv.created_by = me.id
    inv.created_at = utcnow()
    inv.expires_at = utcnow() + timedelta(hours=INVITE_HOURS)
    inv.failures = 0
    db.add(inv)
    db.commit()
    return {"person_id": target.id, "kind": kind, "expires_at": _aware(inv.expires_at).isoformat()}

@router.delete("/vault/invites/{person_id}")
def cancel_invite(
    person_id: int,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    _need_on(db)
    inv = db.get(Invite, person_id)
    if inv:
        db.delete(inv)
        db.commit()
    return {"ok": True}

@router.delete("/vault/events/{event_id}")
def dismiss_event(
    event_id: int,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """Only the person it is about can clear it for everyone."""
    event = db.get(VaultEvent, event_id)
    if event and event.person_id == actor.person_id:
        db.delete(event)
        db.commit()
    return {"ok": True}

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
class InviteIn(BaseModel):
    person_id: int
    login: str
    wrap: str

class Start(BaseModel):
    direction: Literal["on", "off"]
    current: str
    vault_id: str | None = None
    salt: str | None = None
    login_key: str | None = None
    wrap: str | None = None
    recovery_login: str | None = None
    recovery_wrap: str | None = None
    invites: list[InviteIn] = []

@router.post("/vault/convert/start")
def convert_start(
    body: Start,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """Pause the household and build the new file. Turning on: your keys and the others' codes
    go in it now; the records follow from your browser."""
    me = _person(db, actor.person_id)
    on = bool(records.vault_id(db))
    if body.direction == "on" and on:
        raise HTTPException(status_code=409, detail="Encryption is already on.")
    if body.direction == "off" and not on:
        raise HTTPException(status_code=409, detail="Encryption is already off.")
    if body.direction == "off" and records.required():
        raise HTTPException(status_code=403, detail="This server keeps every household encrypted, so it can’t be turned off.")
    if not flag(db, "LOGIN_PAGE"):
        raise HTTPException(status_code=400, detail="Turn on sign-in first: encryption needs everyone to have their own password.")
    if body.direction == "off" and not db.get(VaultKey, me.id):
        raise HTTPException(status_code=403, detail="You have no key yet.")
    _proof(db, me, body.current)
    if body.direction == "on":
        if not body.vault_id or not HEX32.match(body.vault_id):
            raise HTTPException(status_code=400, detail="Not a valid vault id.")
        salt, login, wrap = _salt(body.salt), _hex64(body.login_key, "login key"), _wrap(body.wrap)
        rec_login, rec_wrap = _hex64(body.recovery_login, "recovery key"), _wrap(body.recovery_wrap)
        others = {p.id for p in db.exec(select(Person)).all() if p.id != me.id}
        for inv in body.invites:
            if inv.person_id not in others:
                raise HTTPException(status_code=400, detail="A code can only be for someone else in the household.")
            _hex64(inv.login, "code")
            _wrap(inv.wrap)

    c = conversion.start(body.direction, me.id, me.name)
    try:
        with conversion.next_session() as nx:
            if body.direction == "on":
                for key, value in (("VAULT_ID", body.vault_id), ("VAULT_SEQ", 0), ("VAULT_FLOOR", 0)):
                    nx.add(AppConfig(key=key, value=str(value)))
                _set_kdf(nx, me.id, salt)
                p = nx.get(Person, me.id)
                p.password_hash = hash_password(login)
                p.must_change_password = False
                nx.add(p)
                nx.add(VaultKey(person_id=me.id, wrap=wrap, recovery_hash=hash_password(rec_login), recovery_wrap=rec_wrap, recovery_made=utcnow()))
                for inv in body.invites:
                    nx.add(Invite(person_id=inv.person_id, kind="invite", login_hash=hash_password(inv.login), wrap=inv.wrap,
                                  created_by=me.id, expires_at=utcnow() + timedelta(hours=INVITE_HOURS)))
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
    for c in db.exec(select(Category)).all():
        out.append({"k": "cat", "name": c.name, "color": colors.get(c.name)})
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

def _import_item(nx: Session, item: dict):
    kind = item.get("k")
    try:
        if kind == "tx":
            cents = int(item["cents"])
            if cents <= 0:
                raise ValueError("amount")
            nx.add(Transaction(
                id=UUID(item["id"]), name=item.get("name") or "", category=item["category"], tags=list(item.get("tags") or []),
                amount=from_cents(cents), type=item["type"], date=date.fromisoformat(item["date"]), person_id=item.get("person_id"),
                shares=item.get("shares") or None, paid_by=item.get("paid_by"), note=item.get("note") or "", recurringID=item.get("recurringID") or "",
                created_date=_parse_dt(item.get("created_date")) or utcnow(), created_by=item.get("created_by"), import_ref=item.get("import_ref"),
                source=item.get("source") or None, group_id=item.get("group_id"),
            ))
        elif kind == "rule":
            nx.add(RecurringTransaction(
                id=UUID(item["id"]), name=item.get("name") or "", category=item["category"], tags=list(item.get("tags") or []),
                amount=from_cents(int(item["cents"])), type=item["type"], startDate=date.fromisoformat(item["startDate"]),
                endDate=date.fromisoformat(item["endDate"]) if item.get("endDate") else None, frequency=item["frequency"],
                interval=int(item.get("interval") or 1), person_id=item.get("person_id"), shares=item.get("shares") or None,
                paid_by=item.get("paid_by"), about=bool(item.get("about")), note=item.get("note") or "", paused=bool(item.get("paused")),
                last_run=date.fromisoformat(item["last_run"]) if item.get("last_run") else None, anchor_day=item.get("anchor_day"),
                missed=item.get("missed") or None, created_date=_parse_dt(item.get("created_date")) or utcnow(),
            ))
        elif kind == "cat":
            nx.add(Category(name=item["name"]))
            if item.get("color") is not None:
                nx.add(CategoryColor(name=item["name"], color=int(item["color"])))
        elif kind == "tag":
            nx.add(Tag(name=item["name"]))
        elif kind == "irule":
            nx.add(ImportRule(
                match=item["match"], category=item["category"], person_id=item.get("person_id"), set_person=bool(item.get("set_person", True)),
                uses=int(item.get("uses") or 0), learned=bool(item.get("learned")), position=int(item.get("position") or 0),
                created_at=_parse_dt(item.get("created_at")) or utcnow(),
            ))
        else:
            raise ValueError("kind")
    except (KeyError, ValueError, TypeError) as error:
        raise HTTPException(status_code=400, detail=f"Not a valid {kind or 'item'}: {error}")

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
            _import_item(nx, item)
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
