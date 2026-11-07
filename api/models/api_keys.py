import secrets
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field

def generate_api_key_id():
    return secrets.token_hex(6)

class ApiKeys(SQLModel, table=True):
    id: str = Field(default_factory=generate_api_key_id, primary_key=True)
    key_hash: str
    name: str = Field(default="")
    prefix: str = Field(default="")
    person_id: int | None = Field(default=None, index=True)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
    last_used: str | None = Field(default=None)
    # "read": GET only. "write": read and change, as every key could before scopes.
    scope: str = Field(default="write")
    # With encryption on: the household key, locked by the browser under the secret in this key
    wrap: str | None = Field(default=None)

class ApiKeyCreate(SQLModel):
    name: str = Field(default="", max_length=60)
    scope: str = Field(default="write")
    # With encryption on, the browser makes the key and locks the household key under it
    key: str | None = Field(default=None)
    wrap: str | None = Field(default=None)

class ApiKeyPublic(SQLModel):
    id: str
    name: str
    prefix: str
    person_id: int | None
    created_at: str
    last_used: str | None
    scope: str
