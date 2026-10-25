from typing import Annotated
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlmodel import Session, select, delete

from ..database import get_session
from ..models.people import Person, SessionToken
from ..services import totp
from .auth import (
    Actor, check_login, require_person, flag, set_config, config, hash_password, check_password,
    check_new_password, end_other_sessions, start_session, check_locked, record_failure, clear_failures,
)

router = APIRouter(tags=["Me"])

class PasswordChange(BaseModel):
    current: str = ""
    new: str

class Confirm(BaseModel):
    code: str

class PasswordOnly(BaseModel):
    password: str = ""

class SigninSettings(BaseModel):
    enabled: bool
    require_two_step: bool | None = None
    # First passwords for people who have none yet, by person id. They choose their own at next sign-in.
    passwords: dict[str, str] = {}
    # Turning sign-in off asks for your password
    current: str = ""

def _me(db: Session, actor: Actor) -> Person:
    person = db.get(Person, require_person(actor))
    if not person:
        raise HTTPException(status_code=404, detail="This person does not exist.")
    return person

def _check_current(db: Session, person: Person, password: str):
    """Sensitive changes ask for the current password when sign-in is on."""
    if not flag(db, "LOGIN_PAGE"):
        return
    check_locked(person.id)
    current = person.password_hash or config(db, "LOGIN_PASSWORD")
    if not current or not check_password(password, current):
        left = record_failure(person.id)
        raise HTTPException(status_code=401, detail={"message": "That password is not right.", "tries_left": left})
    clear_failures(person.id)

@router.put("/me/password")
def change_password(
    body: PasswordChange,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    person = _me(db, actor)
    # Someone asked to choose their own password at sign-in has just proved the old one
    if not person.must_change_password:
        _check_current(db, person, body.current)
    check_new_password(body.new)
    person.password_hash = hash_password(body.new)
    person.must_change_password = False
    db.add(person)
    # Changing the password ends every other sign-in for this person
    end_other_sessions(db, person.id, actor.session_id)
    db.commit()
    return {"message": "Password changed"}

@router.get("/me/sessions")
def list_sessions(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    person_id = require_person(actor)
    rows = db.exec(select(SessionToken).where(SessionToken.person_id == person_id).order_by(SessionToken.last_seen.desc())).all()
    return [{"id": r.id[:12], "label": r.label, "created_at": r.created_at, "last_seen": r.last_seen, "expires_at": r.expires_at, "current": r.id == actor.session_id} for r in rows]

@router.delete("/me/sessions/others")
def sign_out_others(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    person_id = require_person(actor)
    end_other_sessions(db, person_id, actor.session_id)
    db.commit()
    return {"message": "Signed out everywhere else"}

@router.post("/me/two-step/setup")
def two_step_setup(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """A new secret to scan. Two-step only turns on once a code from it is confirmed."""
    person = _me(db, actor)
    if person.totp_enabled:
        raise HTTPException(status_code=400, detail="Two-step sign-in is already on.")
    person.totp_secret = totp.new_secret()
    db.add(person)
    db.commit()
    return {"secret": person.totp_secret, "uri": totp.otpauth_uri(person.totp_secret, person.name)}

@router.post("/me/two-step/confirm")
def two_step_confirm(
    body: Confirm,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    person = _me(db, actor)
    if person.totp_enabled or not person.totp_secret:
        raise HTTPException(status_code=400, detail="Start setting up two-step sign-in first.")
    if totp.match(person.totp_secret, body.code) is None:
        raise HTTPException(status_code=400, detail="That code is not right. Check the time on your phone, and type the code shown now.")
    codes = totp.new_recovery_codes()
    person.totp_enabled = True
    person.recovery_codes = [totp.hash_code(c) for c in codes]
    db.add(person)
    db.commit()
    return {"recovery_codes": codes}

@router.delete("/me/two-step")
def two_step_off(
    body: PasswordOnly,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    person = _me(db, actor)
    if flag(db, "REQUIRE_TWO_STEP") and flag(db, "LOGIN_PAGE"):
        raise HTTPException(status_code=400, detail="Two-step sign-in is required for everyone in this household.")
    _check_current(db, person, body.password)
    person.totp_enabled = False
    person.totp_secret = None
    person.recovery_codes = []
    db.add(person)
    end_other_sessions(db, person.id, actor.session_id)
    db.commit()
    return {"message": "Two-step sign-in is off"}

@router.post("/me/two-step/recovery-codes")
def new_recovery_codes(
    body: PasswordOnly,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    person = _me(db, actor)
    if not person.totp_enabled:
        raise HTTPException(status_code=400, detail="Turn on two-step sign-in first.")
    _check_current(db, person, body.password)
    codes = totp.new_recovery_codes()
    person.recovery_codes = [totp.hash_code(c) for c in codes]
    db.add(person)
    db.commit()
    return {"recovery_codes": codes}

@router.get("/me/two-step/recovery-codes")
def recovery_codes_left(
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    person = _me(db, actor)
    return {"left": len(person.recovery_codes or [])}

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

@router.put("/signin")
def update_signin(
    body: SigninSettings,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """Turn sign-in on or off for the household, and whether two-step is required."""
    people = db.exec(select(Person)).all()
    if body.enabled:
        if not people:
            raise HTTPException(status_code=400, detail="Add the people in your household first.")
        me = _me(db, actor)
        household = config(db, "LOGIN_PASSWORD")
        missing = []
        for person in people:
            first = body.passwords.get(str(person.id))
            if first:
                if person.password_hash:
                    raise HTTPException(status_code=400, detail=f"{person.name} already has a password.")
                check_new_password(first)
                person.password_hash = hash_password(first)
                # Everyone but the person turning it on chooses their own at next sign-in
                person.must_change_password = person.id != me.id
                db.add(person)
            elif not person.password_hash and not household:
                missing.append(person.name)
        if missing:
            raise HTTPException(status_code=400, detail={"message": "Everyone needs a first password.", "missing": missing})
        was_on = flag(db, "LOGIN_PAGE")
        set_config(db, "LOGIN_PAGE", True)
        if body.require_two_step is not None:
            set_config(db, "REQUIRE_TWO_STEP", body.require_two_step)
        db.commit()
        if not was_on:
            # Keep the person who turned it on signed in on this browser
            start_session(db, request, response, me.id)
            db.commit()
    else:
        if flag(db, "LOGIN_PAGE") and actor.person_id is not None:
            _check_current(db, _me(db, actor), body.current)
        set_config(db, "LOGIN_PAGE", False)
        set_config(db, "REQUIRE_TWO_STEP", False)
        db.exec(delete(SessionToken))
        db.commit()
    return {"signin": flag(db, "LOGIN_PAGE"), "require_two_step": flag(db, "REQUIRE_TWO_STEP")}
