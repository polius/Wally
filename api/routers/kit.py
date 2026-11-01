"""The household's Emergency Kit: the one way back in when the password is forgotten, with or
without encryption. It also stands in for two-step sign-in, so a forgotten password and a lost
phone together never lock the household out; two-step stays on for everyone else's phones."""
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlmodel import Session, delete

from ..database import get_session
from ..models.people import Person, SessionToken
from ..models.vault import HouseholdKey
from ..services import kit as keys, vault as records
from ..util import utcnow
from .auth import (
    Actor, config, flag, set_config, hash_password, check_password, check_new_password, check_locked, record_failure,
    clear_failures, start_session, is_https, prove_password,
)
from .vault import signed_in, _hex64, _salt, _wrap, _person

router = APIRouter(tags=["Emergency Kit"])

KIT_COOKIE = "wally_kit"
KIT_MINUTES = 15

def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()

def kit_made(db: Session) -> str | None:
    """When the household's kit was made, or None when it has none yet."""
    if records.vault_id(db):
        key = db.get(HouseholdKey, 1)
        return _iso(key.recovery_made) if key and key.recovery_hash else None
    return config(db, "KIT_MADE") or None

def make_plain_kit(db: Session) -> str:
    """A new kit for a household without encryption. The old one stops working. The caller commits."""
    key = keys.new_key()
    set_config(db, "KIT_HASH", hash_password(keys.normalize(key)))
    set_config(db, "KIT_MADE", utcnow().isoformat())
    return key

def forget_plain_kit(db: Session):
    set_config(db, "KIT_HASH", "")
    set_config(db, "KIT_MADE", "")

def _need_signin(db: Session):
    if not flag(db, "LOGIN_PAGE"):
        raise HTTPException(status_code=400, detail="Turn on sign-in first.")

# ---------- a new kit ----------
class NewKit(BaseModel):
    # The password, to replace a kit that exists
    current: str = ""
    # With encryption on, the browser makes the key and sends what the server keeps of it
    recovery_login: str | None = None
    recovery_wrap: str | None = None

@router.post("/kit")
def new_kit(
    body: NewKit,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(signed_in),
):
    """A new Emergency Kit. Replacing one asks for the password; the old one stops working.
    Without encryption the answer holds the key, once: Wally keeps only a hash of it."""
    _need_signin(db)
    if kit_made(db):
        if not body.current:
            # Another browser saved one first, as when two open Wally right after the upgrade
            raise HTTPException(status_code=409, detail="This household already has an Emergency Kit.")
        prove_password(db, body.current)
    if records.vault_id(db):
        key = db.get(HouseholdKey, 1)
        if not key:
            raise HTTPException(status_code=409, detail="This household has no key.")
        key.recovery_hash = hash_password(_hex64(body.recovery_login, "recovery key"))
        key.recovery_wrap = _wrap(body.recovery_wrap)
        key.recovery_made = utcnow()
        db.add(key)
        db.commit()
        return {"made": kit_made(db)}
    key = make_plain_kit(db)
    db.commit()
    return {"key": key, "made": kit_made(db)}

# ---------- forgot the password: the kit, then a new password ----------
class Recover(BaseModel):
    # Who is signing in with it
    person_id: int
    # Without encryption: the key as typed. With it: the login key the browser made from it.
    key: str = ""
    login: str = ""

@router.post("/kit/recover")
def recover(
    body: Recover,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    """Back in with the recovery key from the Emergency Kit: a new household password comes next.
    No two-step code is asked: the kit is enough on its own."""
    _need_signin(db)
    person = _person(db, body.person_id)
    check_locked()
    out = {}
    if records.vault_id(db):
        key = db.get(HouseholdKey, 1)
        ok = bool(key and key.recovery_hash) and check_password(body.login or "", key.recovery_hash)
        if ok:
            out = {"wrap": key.recovery_wrap, "vault_id": records.vault_id(db)}
    else:
        typed = keys.normalize(body.key)
        if typed is None:
            raise HTTPException(status_code=400, detail="That recovery key has a typo. Check each group of four.")
        stored = config(db, "KIT_HASH")
        ok = bool(stored) and check_password(typed, stored)
    if not ok:
        raise HTTPException(status_code=401, detail={"message": "That recovery key is not right.", "tries_left": record_failure()})
    clear_failures()
    token = jwt.encode(
        {"sub": str(person.id), "purpose": "kit", "exp": datetime.now(timezone.utc) + timedelta(minutes=KIT_MINUTES)},
        config(db, "SECRET_KEY"), algorithm="HS512",
    )
    response.set_cookie(KIT_COOKIE, token, max_age=KIT_MINUTES * 60, httponly=True, samesite="lax", secure=is_https(request), path="/")
    return out

class KitPassword(BaseModel):
    # The new password, or the login key made from it when there is a salt
    new: str
    salt: str | None = None
    # With encryption on: the household key, locked under the new password
    wrap: str | None = None

@router.post("/kit/password")
def new_password(
    body: KitPassword,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    """After the recovery key: the new household password. Every browser signs in again with it."""
    try:
        claims = jwt.decode(request.cookies.get(KIT_COOKIE) or "", config(db, "SECRET_KEY"), algorithms=["HS512"])
        assert claims.get("purpose") == "kit"
        person = db.get(Person, int(claims["sub"]))
        assert person
    except Exception:
        raise HTTPException(status_code=401, detail="That took too long. Start again.")
    if records.vault_id(db):
        salt, login, wrap = _salt(body.salt), _hex64(body.new, "login key"), _wrap(body.wrap)
        key = db.get(HouseholdKey, 1)
        if not key:
            raise HTTPException(status_code=409, detail="This household has no key.")
        key.wrap = wrap
        db.add(key)
        set_config(db, "LOGIN_SALT", salt)
    elif body.salt:
        login = _hex64(body.new, "login key")
        set_config(db, "LOGIN_SALT", _salt(body.salt))
    else:
        check_new_password(body.new)
        login = body.new
        set_config(db, "LOGIN_SALT", "")
    set_config(db, "LOGIN_PASSWORD", hash_password(login))
    db.exec(delete(SessionToken))
    start_session(db, request, response, person.id)
    response.delete_cookie(KIT_COOKIE, path="/")
    db.commit()
    return {"ok": True}
