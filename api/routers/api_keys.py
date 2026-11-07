import secrets
from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select, func

from ..database import get_session, STATE
from ..models.api_keys import ApiKeys, ApiKeyCreate, ApiKeyPublic
from ..models.vault import Record
from ..services import sealing
from ..services.vault import api_keys_allowed, vault_id
from .auth import Actor, check_login, hash_key

MAX_API_KEYS = 5
SCOPES = ("read", "write")

router = APIRouter(tags=["API Keys"], dependencies=[Depends(check_login)])

def _not_by_key(actor: Actor):
    # A key can't make or delete keys: that takes someone signed in
    if actor.via == "key":
        raise HTTPException(status_code=403, detail="Manage API keys in Settings › API keys.")

@router.get("/api-keys", response_model=list[ApiKeyPublic])
def list_api_keys(
    db: Annotated[Session, Depends(get_session)],
):
    return db.exec(select(ApiKeys).order_by(ApiKeys.created_at)).all()

@router.post("/api-keys")
def create_api_key(
    db: Annotated[Session, Depends(get_session)],
    body: ApiKeyCreate | None = None,
    actor: Actor = Depends(check_login),
):
    """A new key, shown once. With encryption on, the browser makes it and locks the household key
    under it (web/js/vault/session.js): the server keeps that lock and a hash of the key, never the key."""
    _not_by_key(actor)
    if not api_keys_allowed():
        raise HTTPException(status_code=400, detail="API keys are off on this server.")
    body = body or ApiKeyCreate()
    if body.scope not in SCOPES:
        raise HTTPException(status_code=400, detail="A key can read, or read and write.")
    # Enforce max API keys limit, per person
    count = db.exec(select(func.count()).select_from(ApiKeys).where(ApiKeys.person_id == actor.person_id)).one()
    if count >= MAX_API_KEYS:
        raise HTTPException(status_code=400, detail=f"Maximum of {MAX_API_KEYS} API keys each")

    wrap = None
    if STATE.get("vault"):
        raw_key = body.key or ""
        if not sealing.KEY.match(raw_key) or not body.wrap:
            raise HTTPException(status_code=400, detail="While Wally is encrypted, keys are made in the browser. Reload Wally and try again.")
        # The lock must open with this key, or the key would open nothing
        secret = sealing.unlock_with_api_key(raw_key, body.wrap, vault_id(db))
        sample = db.exec(select(Record).where(Record.deleted == False).limit(1)).first()  # noqa: E712
        if not secret or (sample and sealing.Household(secret).open(sample.id, sample.version, sample.ct) is None):
            raise HTTPException(status_code=400, detail="This key doesn’t open the household’s data. Reload Wally and try again.")
        wrap = body.wrap
    else:
        # 32 random bytes. The prefix finds it without checking every hash.
        raw_key = "wly_" + secrets.token_hex(32)

    api_key = ApiKeys(key_hash=hash_key(raw_key), prefix=raw_key[:8], name=body.name.strip(), person_id=actor.person_id, scope=body.scope, wrap=wrap)
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    # Return the plaintext key only once
    return {
        "id": api_key.id,
        "key": raw_key,
        "name": api_key.name,
        "prefix": api_key.prefix,
        "person_id": api_key.person_id,
        "scope": api_key.scope,
        "created_at": api_key.created_at,
    }

@router.delete("/api-keys/{api_key_id}")
def delete_api_key(
    api_key_id: str,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    _not_by_key(actor)
    api_key = db.get(ApiKeys, api_key_id)
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    # Deleting the key deletes its lock: the key opens nothing after this
    db.delete(api_key)
    db.commit()
    return {"message": "API key deleted"}
