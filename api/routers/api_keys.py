import secrets
import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select, func

from ..database import get_session
from ..models.api_keys import ApiKeys, ApiKeyCreate, ApiKeyPublic
from .auth import Actor, check_login

MAX_API_KEYS = 5

router = APIRouter(tags=["API Keys"], dependencies=[Depends(check_login)])

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
    # Enforce max API keys limit, per person
    count = db.exec(select(func.count()).select_from(ApiKeys).where(ApiKeys.person_id == actor.person_id)).one()
    if count >= MAX_API_KEYS:
        raise HTTPException(status_code=400, detail=f"Maximum of {MAX_API_KEYS} API keys each")

    # Generate a random API key. The prefix finds it without checking every hash.
    raw_key = "wly_" + secrets.token_hex(30)

    # Hash the key for storage
    key_hash = bcrypt.hashpw(raw_key.encode('utf-8'), bcrypt.gensalt()).decode()

    # Create the record. Entries sent with it are added by the person who made it.
    api_key = ApiKeys(key_hash=key_hash, prefix=raw_key[:8], name=(body.name.strip() if body else ""), person_id=actor.person_id)
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
        "created_at": api_key.created_at,
    }

@router.delete("/api-keys/{api_key_id}")
def delete_api_key(
    api_key_id: str,
    db: Annotated[Session, Depends(get_session)],
):
    api_key = db.get(ApiKeys, api_key_id)
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    db.delete(api_key)
    db.commit()
    return {"message": "API key deleted"}
