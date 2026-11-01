import os
import time
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated

import bcrypt
import jwt
from pydantic import BaseModel, Field
from fastapi import Depends, APIRouter, HTTPException, Request, Response
from sqlmodel import Session, select, delete

from ..database import get_session, STATE
from ..models.app import AppConfig
from ..models.api_keys import ApiKeys
from ..models.people import Person, SessionToken, person_public
from ..services import totp
from ..util import utcnow

SESSION_COOKIE = "wally_session"
PENDING_COOKIE = "wally_pending"
SESSION_DAYS = 365
PENDING_MINUTES = 5
MAX_FAILURES = 5
LOCK_SECONDS = 30
MIN_PASSWORD = 8

class Login(BaseModel):
    # Who is signing in. None only before anyone has been added (just upgraded from 1.x).
    person_id: int | None = None
    password: str

class LoginCode(BaseModel):
    code: str = ""
    recovery_code: str = ""

@dataclass
class Actor:
    """Who is making a request. person_id is None only before anyone has been added."""
    person_id: int | None
    via: str  # "session", "key" or "open" (sign-in is off, so it is on trust)
    session_id: str | None = None

def is_https(request: Request) -> bool:
    """Auto-detect if the request was made over HTTPS using the X-Forwarded-Proto header."""
    return request.headers.get("x-forwarded-proto", request.url.scheme) == "https"

def config(db: Session, key: str, default: str = "") -> str:
    row = db.get(AppConfig, key)
    return row.value if row else default

def flag(db: Session, key: str) -> bool:
    return config(db, key, "0") in ("1", "true", "True")

def set_config(db: Session, key: str, value):
    row = db.get(AppConfig, key)
    if isinstance(value, bool):
        value = "1" if value else "0"
    if row:
        row.value = str(value)
    else:
        db.add(AppConfig(key=key, value=str(value)))

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode()

def check_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False

def check_new_password(password: str):
    if len(password) < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Use at least {MIN_PASSWORD} characters.")

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

# ---------- wrong tries ----------
# Five wrong passwords or codes: wait 30 seconds. One count for the household, since everyone types
# the same password. Kept in memory on purpose: a restart clears it, and it never locks anyone out for long.
_failures: list[float] = []
# The last two-step counter used, so one code cannot be used twice
_last_counter = {"value": -1}

def check_locked():
    if len(_failures) >= MAX_FAILURES:
        wait = LOCK_SECONDS - (time.monotonic() - _failures[-1])
        if wait > 0:
            raise HTTPException(status_code=429, detail={"message": "Too many tries. Wait a moment.", "retry_after": int(wait) + 1})
        _failures.clear()

def record_failure() -> int:
    _failures.append(time.monotonic())
    return max(MAX_FAILURES - len(_failures), 0)

def clear_failures():
    _failures.clear()

def wrong_password():
    raise HTTPException(status_code=401, detail={"message": "That password is not right.", "tries_left": record_failure()})

# ---------- the household password ----------
def password_salt(db: Session) -> str:
    """With a salt, the browser turns the password into keys (Argon2id) and sends only a login key
    made from it. Always so with encryption on; the salt stays when encryption is turned off."""
    return config(db, "LOGIN_SALT")

def is_household_password(db: Session, value: str) -> bool:
    stored = config(db, "LOGIN_PASSWORD")
    return bool(stored) and check_password(value or "", stored)

def prove_password(db: Session, value: str):
    """Sensitive changes ask for the household password: the login key, when there is a salt."""
    check_locked()
    if not is_household_password(db, value):
        wrong_password()
    clear_failures()

# ---------- two-step sign-in, one for the household ----------
def two_step_on(db: Session) -> bool:
    return flag(db, "TWO_STEP") and bool(config(db, "TOTP_SECRET"))

def recovery_hashes(db: Session) -> list[str]:
    try:
        return list(json.loads(config(db, "TOTP_RECOVERY") or "[]"))
    except ValueError:
        return []

def set_recovery_hashes(db: Session, hashes: list[str]):
    set_config(db, "TOTP_RECOVERY", json.dumps(hashes))

def turn_two_step_off(db: Session):
    set_config(db, "TWO_STEP", False)
    set_config(db, "TOTP_SECRET", "")
    set_config(db, "TOTP_PENDING", "")
    set_recovery_hashes(db, [])

# ---------- sessions ----------
def start_session(db: Session, request: Request, response: Response, person_id: int | None):
    token = secrets.token_urlsafe(32)
    now = utcnow()
    db.add(SessionToken(
        id=hash_token(token),
        person_id=person_id,
        created_at=now,
        last_seen=now,
        expires_at=now + timedelta(days=SESSION_DAYS),
        label=request.headers.get("user-agent", "")[:200],
    ))
    response.set_cookie(
        key=SESSION_COOKIE, value=token, max_age=SESSION_DAYS * 86400,
        httponly=True, samesite="lax", secure=is_https(request), path="/",
    )
    response.delete_cookie(PENDING_COOKIE, path="/")

def end_other_sessions(db: Session, keep: str | None):
    """Every other browser in the household signs in again, as after a new password."""
    stmt = delete(SessionToken)
    if keep:
        stmt = stmt.where(SessionToken.id != keep)
    db.exec(stmt)

def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

def _session_actor(db: Session, request: Request) -> Actor | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    row = db.get(SessionToken, hash_token(token))
    if not row or _aware(row.expires_at) < utcnow():
        return None
    if row.person_id is not None and not db.get(Person, row.person_id):
        return None
    # Note when it was last used, at most once an hour, and never while the database is being converted
    if utcnow() - _aware(row.last_seen) > timedelta(hours=1) and not STATE.get("conversion"):
        row.last_seen = utcnow()
        db.add(row)
        db.commit()
    return Actor(person_id=row.person_id, via="session", session_id=row.id)

def _key_actor(db: Session, raw_key: str) -> Actor | None:
    prefix = raw_key[:8]
    candidates = db.exec(select(ApiKeys).where((ApiKeys.prefix == prefix) | (ApiKeys.prefix == ""))).all()
    for ak in candidates:
        if check_password(raw_key, ak.key_hash):
            ak.last_used = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            db.add(ak)
            db.commit()
            return Actor(person_id=ak.person_id, via="key")
    return None

def _open_actor(db: Session, request: Request) -> Actor:
    """Sign-in is off: the browser says who is using it, and that is taken on trust."""
    person_id = None
    raw = request.headers.get("x-wally-person", "")
    if raw.isdigit() and db.get(Person, int(raw)):
        person_id = int(raw)
    return Actor(person_id=person_id, via="open")

def vault_on() -> bool:
    return bool(STATE.get("vault"))

def identify(db: Session, request: Request) -> Actor | None:
    raw_key = request.headers.get("x-api-key")
    if raw_key and vault_on():
        # The server cannot read an encrypted household's data, so a script with a key has nothing to use
        raise HTTPException(status_code=401, detail="API keys are off while encryption is on.")
    if raw_key:
        actor = _key_actor(db, raw_key)
        if actor:
            return actor
        if flag(db, "LOGIN_PAGE"):
            raise HTTPException(status_code=401, detail="Invalid API key")
    if not flag(db, "LOGIN_PAGE"):
        return _open_actor(db, request)
    return _session_actor(db, request)

def check_login(
    request: Request,
    db: Annotated[Session, Depends(get_session)],
) -> Actor:
    actor = identify(db, request)
    if actor is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return actor

def require_person(actor: Actor) -> int:
    if actor.person_id is None:
        raise HTTPException(status_code=400, detail="Add yourself in Settings › People first.")
    return actor.person_id

# Initialize FastAPI router
router = APIRouter(tags=["Auth"])

def _people(db: Session) -> list[Person]:
    return db.exec(select(Person).order_by(Person.position, Person.id)).all()

@router.get("/auth/status")
def auth_status(
    request: Request,
    db: Annotated[Session, Depends(get_session)],
):
    """Everything the web app needs before it can show anything: is sign-in on, who is here, who am I."""
    from ..main import VERSION
    if STATE["read_only"]:
        return {"read_only": STATE["read_only"], "version": VERSION, "signin": False, "people": [], "me": None, "signed_in": False}
    signin = flag(db, "LOGIN_PAGE")
    try:
        actor = identify(db, request)
    except HTTPException:
        actor = None
    me = db.get(Person, actor.person_id) if actor and actor.person_id is not None else None
    from .vault import vault_status
    return {
        "vault": vault_status(db),
        "signin": signin,
        "two_step": signin and two_step_on(db),
        "signed_in": actor is not None,
        "people": [person_public(p) for p in _people(db)],
        "me": person_public(me) if me else None,
        # When the household's Emergency Kit was made. None: Forgot password can't help, and
        # whoever signs in next is asked to save one.
        "kit": _kit_made(db) if signin else None,
        "onboarded": flag(db, "ONBOARDED"),
        # The upgrade from 1.x, until someone has read it
        "upgrade": _upgrade_report(db) if actor is not None else None,
        "demo": os.getenv("DEMO", "false").lower() == "true",
        "read_only": STATE["read_only"],
        "version": VERSION,
        "language": config(db, "LANGUAGE", "en"),
    }

def _kit_made(db: Session) -> str | None:
    from .kit import kit_made
    return kit_made(db)

def _upgrade_report(db: Session) -> dict | None:
    import json
    if flag(db, "UPGRADE_SEEN"):
        return None
    try:
        return json.loads(config(db, "UPGRADE_REPORT") or "null")
    except ValueError:
        return None

@router.post("/login")
def login(
    login: Login,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    """The household password, for the person who says who they are. With a salt, the browser
    sends a login key made from the password, never the password itself."""
    if not flag(db, "LOGIN_PAGE"):
        return {"ok": True, "message": "Sign-in is off"}

    person = db.get(Person, login.person_id) if login.person_id is not None else None
    if login.person_id is not None and not person:
        raise HTTPException(status_code=404, detail="This person does not exist.")
    if person is None and _people(db):
        raise HTTPException(status_code=400, detail="Pick who is signing in.")

    check_locked()
    if not is_household_password(db, login.password):
        wrong_password()
    clear_failures()

    if two_step_on(db):
        _pending_code(db, request, response, person)
        db.commit()
        return {"ok": True, "code_needed": True}

    start_session(db, request, response, person.id if person else None)
    db.commit()
    return {"ok": True, "code_needed": False}

def _pending_code(db: Session, request: Request, response: Response, person: Person | None):
    """The password was right: the code from the authenticator app comes next, within five minutes."""
    pending = jwt.encode(
        {"sub": str(person.id) if person else "", "purpose": "code", "exp": datetime.now(timezone.utc) + timedelta(minutes=PENDING_MINUTES)},
        config(db, "SECRET_KEY"), algorithm="HS512",
    )
    response.set_cookie(PENDING_COOKIE, pending, max_age=PENDING_MINUTES * 60, httponly=True, samesite="lax", secure=is_https(request), path="/")

def second_step(db: Session, code: str, recovery_code: str) -> bool:
    """A code from the authenticator app, or one of the household's recovery codes."""
    if recovery_code:
        hashed = totp.hash_code(recovery_code)
        hashes = recovery_hashes(db)
        if hashed in hashes:
            set_recovery_hashes(db, [c for c in hashes if c != hashed])
            return True
        return False
    secret = config(db, "TOTP_SECRET")
    counter = totp.match(secret, code) if secret else None
    if counter is not None and counter > _last_counter["value"]:
        _last_counter["value"] = counter
        return True
    return False

@router.post("/login/code")
def login_code(
    body: LoginCode,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    pending = request.cookies.get(PENDING_COOKIE)
    try:
        claims = jwt.decode(pending or "", config(db, "SECRET_KEY"), algorithms=["HS512"])
        assert claims.get("purpose") == "code" and two_step_on(db)
        person_id = int(claims["sub"]) if claims.get("sub") else None
        assert person_id is None or db.get(Person, person_id)
    except Exception:
        raise HTTPException(status_code=401, detail="Sign in again: that took too long.")

    check_locked()
    if not second_step(db, body.code, body.recovery_code):
        message = "That recovery code is not right, or it was already used." if body.recovery_code else "That code is not right. Codes change every 30 seconds."
        raise HTTPException(status_code=401, detail={"message": message, "tries_left": record_failure()})

    clear_failures()
    start_session(db, request, response, person_id)
    db.commit()
    return {"ok": True, "recovery_codes_left": len(recovery_hashes(db))}

@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        row = db.get(SessionToken, hash_token(token))
        if row:
            db.delete(row)
            db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(PENDING_COOKIE, path="/")
    return {"message": "Signed out"}

@router.get("/login/check", response_model=bool)
def get_login_page_enabled(
    db: Annotated[Session, Depends(get_session)],
    _ = Depends(check_login),
):
    return flag(db, "LOGIN_PAGE")

@router.get("/language")
def get_language(
    db: Annotated[Session, Depends(get_session)],
):
    return {"language": config(db, "LANGUAGE", "en")}

@router.put("/language/{language}")
def update_language(
    language: str,
    db: Annotated[Session, Depends(get_session)],
    _ = Depends(check_login),
):
    set_config(db, "LANGUAGE", language)
    db.commit()
    return {"message": "Language updated"}
