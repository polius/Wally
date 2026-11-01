"""The household's sign-in: one password, one two-step sign-in, the browsers signed in, and each
person's own choices (prefs)."""
from typing import Annotated
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlmodel import Session, select, delete

from ..database import get_session
from ..models.people import Person, SessionToken
from ..services import totp
from .auth import (
    Actor, check_login, require_person, flag, set_config, config, hash_password, check_new_password,
    end_other_sessions, start_session, prove_password, password_salt, vault_on, two_step_on, turn_two_step_off,
    recovery_hashes, set_recovery_hashes,
)

router = APIRouter(tags=["Sign-in"])

class PasswordChange(BaseModel):
    current: str = ""
    new: str
    # Set when the browser makes keys from the password (Argon2id): the new salt, and with
    # encryption on, the household key locked under the new password
    salt: str | None = None
    wrap: str | None = None

class Confirm(BaseModel):
    code: str
    # It changes how everyone signs in, so it asks for the password
    password: str = ""

class PasswordOnly(BaseModel):
    password: str = ""

class SigninSettings(BaseModel):
    enabled: bool
    # Turning sign-in on: the household password everyone will use
    password: str = ""
    # Turning sign-in off asks for the password
    current: str = ""

def _me(db: Session, actor: Actor) -> Person:
    person = db.get(Person, require_person(actor))
    if not person:
        raise HTTPException(status_code=404, detail="This person does not exist.")
    return person

def _check_current(db: Session, password: str):
    """Sensitive changes ask for the household password when sign-in is on."""
    if flag(db, "LOGIN_PAGE"):
        prove_password(db, password)

def _need_signin(db: Session):
    if not flag(db, "LOGIN_PAGE"):
        raise HTTPException(status_code=400, detail="Turn on sign-in first.")

# ---------- the household password ----------
@router.put("/password")
def change_password(
    body: PasswordChange,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """A new household password for everyone. Every other browser signs in again with it."""
    from ..models.vault import HouseholdKey
    from .vault import _salt, _wrap, _hex64
    _need_signin(db)
    encrypted = vault_on()
    prove_password(db, body.current)
    if encrypted or body.salt or password_salt(db):
        # A login key, not a password: its length was checked in the browser
        _hex64(body.new, "login key")
        set_config(db, "LOGIN_SALT", _salt(body.salt))
    else:
        check_new_password(body.new)
        set_config(db, "LOGIN_SALT", "")
    if encrypted:
        key = db.get(HouseholdKey, 1)
        if not key:
            raise HTTPException(status_code=409, detail="This household has no key.")
        key.wrap = _wrap(body.wrap)
        db.add(key)
    set_config(db, "LOGIN_PASSWORD", hash_password(body.new))
    end_other_sessions(db, actor.session_id)
    db.commit()
    return {"message": "Password changed"}

# ---------- signed-in browsers ----------
@router.get("/sessions")
def list_sessions(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    rows = db.exec(select(SessionToken).order_by(SessionToken.last_seen.desc())).all()
    return [{"id": r.id[:12], "person_id": r.person_id, "label": r.label, "created_at": r.created_at, "last_seen": r.last_seen,
             "expires_at": r.expires_at, "current": r.id == actor.session_id} for r in rows]

@router.delete("/sessions/others")
def sign_out_others(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    end_other_sessions(db, actor.session_id)
    db.commit()
    return {"message": "Signed out everywhere else"}

# ---------- two-step sign-in: one code for the household, on everyone's phone ----------
def _uri(secret: str) -> str:
    return totp.otpauth_uri(secret, "Household")

@router.post("/two-step/setup")
def two_step_setup(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """A new secret to scan. Two-step only turns on once a code from it is confirmed."""
    _need_signin(db)
    if two_step_on(db):
        raise HTTPException(status_code=400, detail="Two-step sign-in is already on.")
    secret = totp.new_secret()
    set_config(db, "TOTP_PENDING", secret)
    db.commit()
    return {"secret": secret, "uri": _uri(secret)}

@router.post("/two-step/confirm")
def two_step_confirm(
    body: Confirm,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    pending = config(db, "TOTP_PENDING")
    if two_step_on(db) or not pending:
        raise HTTPException(status_code=400, detail="Start setting up two-step sign-in first.")
    _check_current(db, body.password)
    if totp.match(pending, body.code) is None:
        raise HTTPException(status_code=400, detail="That code is not right. Check the time on your phone, and type the code shown now.")
    codes = totp.new_recovery_codes()
    set_config(db, "TOTP_SECRET", pending)
    set_config(db, "TOTP_PENDING", "")
    set_config(db, "TWO_STEP", True)
    set_recovery_hashes(db, [totp.hash_code(c) for c in codes])
    db.commit()
    return {"recovery_codes": codes}

@router.post("/two-step/show")
def two_step_show(
    body: PasswordOnly,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """The same secret again, to add another phone: a new one, or someone new in the household."""
    if not two_step_on(db):
        raise HTTPException(status_code=400, detail="Turn on two-step sign-in first.")
    prove_password(db, body.password)
    secret = config(db, "TOTP_SECRET")
    return {"secret": secret, "uri": _uri(secret)}

@router.delete("/two-step")
def two_step_off(
    body: PasswordOnly,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    _check_current(db, body.password)
    turn_two_step_off(db)
    db.commit()
    return {"message": "Two-step sign-in is off"}

@router.post("/two-step/recovery-codes")
def new_recovery_codes(
    body: PasswordOnly,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    if not two_step_on(db):
        raise HTTPException(status_code=400, detail="Turn on two-step sign-in first.")
    _check_current(db, body.password)
    codes = totp.new_recovery_codes()
    set_recovery_hashes(db, [totp.hash_code(c) for c in codes])
    db.commit()
    return {"recovery_codes": codes}

@router.get("/two-step/recovery-codes")
def recovery_codes_left(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    return {"left": len(recovery_hashes(db)) if two_step_on(db) else 0}

# ---------- after the upgrade from 1.x: this browser becomes someone ----------
class Claim(BaseModel):
    person_id: int

@router.post("/me/claim")
def claim(
    body: Claim,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """The browser that signed in with the 1.x password, before anyone was added, becomes the
    person on the "You" row: no signing out and in again. Only a sign-in that is nobody yet can."""
    if actor.via != "session" or actor.person_id is not None:
        raise HTTPException(status_code=400, detail="This browser is already signed in as someone.")
    person = db.get(Person, body.person_id)
    if not person:
        raise HTTPException(status_code=404, detail="This person does not exist.")
    row = db.get(SessionToken, actor.session_id)
    row.person_id = person.id
    db.add(row)
    db.commit()
    return {"ok": True}

# ---------- each person's own choices ----------
@router.put("/me/prefs")
def update_prefs(
    prefs: dict,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """Per-person choices that follow them to every device, like the Dashboard's widgets."""
    person = _me(db, actor)
    person.prefs = {**(person.prefs or {}), **prefs}
    db.add(person)
    db.commit()
    return person.prefs

@router.get("/me/prefs")
def read_prefs(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    if actor.person_id is None:
        return {}
    return _me(db, actor).prefs or {}

# ---------- sign-in on or off ----------
@router.put("/signin")
def update_signin(
    body: SigninSettings,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """Turn sign-in on, with the household password everyone will use and its Emergency Kit, or off."""
    from .kit import make_plain_kit
    if body.enabled:
        if flag(db, "LOGIN_PAGE"):
            return {"signin": True}
        if not db.exec(select(Person)).first():
            raise HTTPException(status_code=400, detail="Add the people in your household first.")
        me = _me(db, actor)
        check_new_password(body.password)
        set_config(db, "LOGIN_PASSWORD", hash_password(body.password))
        set_config(db, "LOGIN_SALT", "")
        set_config(db, "LOGIN_PAGE", True)
        # The way back in if the password is forgotten: shown once, now
        kit = make_plain_kit(db)
        db.commit()
        # Keep the person who turned it on signed in on this browser
        start_session(db, request, response, me.id)
        db.commit()
        return {"signin": True, "kit": kit}
    from ..services.vault import required
    if required():
        raise HTTPException(status_code=400, detail="This server keeps every household encrypted, so sign-in stays on.")
    if vault_on():
        raise HTTPException(status_code=400, detail="Sign-in stays on while encryption is on. Turn off encryption first, in Settings › Privacy.")
    _check_current(db, body.current)
    turn_signin_off(db)
    db.commit()
    return {"signin": False}

def turn_signin_off(db: Session):
    """No password, no kit and no two-step are left: turning sign-in on again asks for a new password.
    Also what `python -m api.signin_off` does for whoever runs the server. The caller commits."""
    from .kit import forget_plain_kit
    for key in ("LOGIN_PASSWORD", "LOGIN_SALT"):
        set_config(db, key, "")
    set_config(db, "LOGIN_PAGE", False)
    forget_plain_kit(db)
    turn_two_step_off(db)
    db.exec(delete(SessionToken))
