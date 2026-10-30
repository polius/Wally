import os
import time
import hashlib
import secrets
import string
from dataclasses import dataclass
from pathlib import Path
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

def recovery_file() -> Path:
    return Path(os.getenv("WALLY_RECOVERY_FILE", "password.txt")).resolve()

# The line in password.txt for the household password, asked for before anyone has been added
HOUSEHOLD_LINE = "Household password"

class Login(BaseModel):
    person_id: int | None = None
    password: str

class LoginCode(BaseModel):
    code: str = ""
    recovery_code: str = ""

class Recover(BaseModel):
    person_id: int | None = None

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
# Five wrong passwords or codes for one person: wait 30 seconds. Kept in memory on purpose:
# a restart clears it, and it never locks anyone out for long.
_failures: dict[str, list[float]] = {}
# The last two-step counter each person used, so one code cannot be used twice
_last_counter: dict[int, int] = {}

def _key(person_id: int | None) -> str:
    return str(person_id)

def check_locked(person_id: int | None):
    tries = _failures.get(_key(person_id), [])
    if len(tries) >= MAX_FAILURES:
        wait = LOCK_SECONDS - (time.monotonic() - tries[-1])
        if wait > 0:
            raise HTTPException(status_code=429, detail={"message": "Too many tries. Wait a moment.", "retry_after": int(wait) + 1})
        _failures.pop(_key(person_id), None)

def record_failure(person_id: int | None) -> int:
    tries = _failures.setdefault(_key(person_id), [])
    tries.append(time.monotonic())
    return max(MAX_FAILURES - len(tries), 0)

def clear_failures(person_id: int | None):
    _failures.pop(_key(person_id), None)

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

def end_other_sessions(db: Session, person_id: int, keep: str | None):
    stmt = delete(SessionToken).where(SessionToken.person_id == person_id)
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
    # Note when it was last used, at most once an hour
    if utcnow() - _aware(row.last_seen) > timedelta(hours=1):
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

def identify(db: Session, request: Request) -> Actor | None:
    raw_key = request.headers.get("x-api-key")
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
    return {
        "signin": signin,
        "require_two_step": flag(db, "REQUIRE_TWO_STEP"),
        "signed_in": actor is not None,
        "people": [person_public(p) for p in _people(db)],
        "me": person_public(me) if me else None,
        "must_change_password": bool(me and signin and me.must_change_password),
        "needs_two_step": bool(me and signin and flag(db, "REQUIRE_TWO_STEP") and not me.totp_enabled),
        "household_password": bool(config(db, "LOGIN_PASSWORD")),
        "onboarded": flag(db, "ONBOARDED"),
        "demo": os.getenv("DEMO", "false").lower() == "true",
        "read_only": STATE["read_only"],
        "version": VERSION,
        "language": config(db, "LANGUAGE", "en"),
    }

@router.post("/login")
def login(
    login: Login,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    if not flag(db, "LOGIN_PAGE"):
        return {"ok": True, "message": "Sign-in is off"}

    people = _people(db)
    person = db.get(Person, login.person_id) if login.person_id is not None else None
    if login.person_id is not None and not person:
        raise HTTPException(status_code=404, detail="This person does not exist.")
    if person is None and people:
        raise HTTPException(status_code=400, detail="Pick who is signing in.")

    check_locked(login.person_id)

    household = config(db, "LOGIN_PASSWORD")
    recovered = False
    if person and person.password_hash:
        ok = check_password(login.password, person.password_hash)
    else:
        # Before choosing their own, everyone signs in with the household password
        ok = bool(household) and check_password(login.password, household)

    if not ok and person:
        recovered = _use_recovery_password(person.name, login.password)
        ok = recovered
    elif not ok and not people and _use_recovery_password(HOUSEHOLD_LINE, login.password):
        # It becomes the household password: everyone added next signs in with it the first time
        set_config(db, "LOGIN_PASSWORD", hash_password(login.password))
        ok = True

    if not ok:
        left = record_failure(login.person_id)
        raise HTTPException(status_code=401, detail={"message": "That password is not right.", "tries_left": left})

    clear_failures(login.person_id)

    if recovered:
        # A one-time password also turns two-step off, so a lost phone never locks anyone out
        person.totp_enabled = False
        person.totp_secret = None
        person.recovery_codes = []
        person.must_change_password = True
        db.add(person)
    elif person and not person.password_hash:
        person.must_change_password = True
        db.add(person)

    if person and person.totp_enabled:
        pending = jwt.encode(
            {"sub": str(person.id), "purpose": "code", "exp": datetime.now(timezone.utc) + timedelta(minutes=PENDING_MINUTES)},
            config(db, "SECRET_KEY"), algorithm="HS512",
        )
        response.set_cookie(PENDING_COOKIE, pending, max_age=PENDING_MINUTES * 60, httponly=True, samesite="lax", secure=is_https(request), path="/")
        db.commit()
        return {"ok": True, "code_needed": True}

    start_session(db, request, response, person.id if person else None)
    db.commit()
    return {"ok": True, "code_needed": False, "must_change_password": bool(person and person.must_change_password)}

def _use_recovery_password(name: str, password: str) -> bool:
    """password.txt holds one line per person who asked: "Name: one-time password"."""
    path = recovery_file()
    if not path.exists():
        return False
    lines = path.read_text(encoding="utf-8").splitlines()
    kept, matched = [], False
    for line in lines:
        who, _, value = line.partition(": ")
        if not matched and who == name and value and secrets.compare_digest(value.strip(), password):
            matched = True
            continue
        kept.append(line)
    if matched:
        if kept:
            path.write_text("\n".join(kept) + "\n", encoding="utf-8")
        else:
            path.unlink(missing_ok=True)
    return matched

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
        assert claims.get("purpose") == "code"
        person = db.get(Person, int(claims["sub"]))
        assert person and person.totp_enabled and person.totp_secret
    except Exception:
        raise HTTPException(status_code=401, detail="Sign in again: that took too long.")

    check_locked(person.id)
    ok = False
    if body.recovery_code:
        hashed = totp.hash_code(body.recovery_code)
        if hashed in (person.recovery_codes or []):
            person.recovery_codes = [c for c in person.recovery_codes if c != hashed]
            db.add(person)
            ok = True
    else:
        counter = totp.match(person.totp_secret, body.code)
        if counter is not None and counter > _last_counter.get(person.id, -1):
            _last_counter[person.id] = counter
            ok = True

    if not ok:
        left = record_failure(person.id)
        message = "That recovery code is not right, or it was already used." if body.recovery_code else "That code is not right. Codes change every 30 seconds."
        raise HTTPException(status_code=401, detail={"message": message, "tries_left": left})

    clear_failures(person.id)
    start_session(db, request, response, person.id)
    db.commit()
    return {"ok": True, "must_change_password": person.must_change_password, "recovery_codes_left": len(person.recovery_codes or [])}

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

@router.post("/login/recover")
def recover_password(
    body: Recover,
    db: Annotated[Session, Depends(get_session)],
):
    """Write a one-time password for this person to password.txt on the server, or, before anyone has
    been added (just upgraded from 1.x), a new household password."""
    if body.person_id is None:
        if _people(db):
            raise HTTPException(status_code=400, detail="Pick who is signing in.")
        name = HOUSEHOLD_LINE
    else:
        person = db.get(Person, body.person_id)
        if not person:
            raise HTTPException(status_code=404, detail="This person does not exist.")
        name = person.name
    chars = string.ascii_letters + string.digits
    password = "".join(secrets.choice(chars) for _ in range(12))
    path = recovery_file()
    lines = [l for l in (path.read_text(encoding="utf-8").splitlines() if path.exists() else []) if not l.startswith(f"{name}: ")]
    lines.append(f"{name}: {password}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"message": "Recovery password written.", "file": str(path)}

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
