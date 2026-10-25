from datetime import datetime
from sqlalchemy import Column, JSON
from sqlmodel import SQLModel, Field

from ..util import utcnow

class Person(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    position: int = Field(default=0)
    # Sign-in. A person without a password hash signs in with the household password
    # (the one v1 had) and is asked to choose their own.
    password_hash: str | None = Field(default=None)
    must_change_password: bool = Field(default=False)
    totp_secret: str | None = Field(default=None)
    totp_enabled: bool = Field(default=False)
    recovery_codes: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    prefs: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)

class PersonCreate(SQLModel):
    name: str = Field(min_length=1, max_length=40)

class PersonUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    position: int | None = None

class PersonPublic(SQLModel):
    id: int
    name: str
    position: int
    two_step: bool
    has_password: bool

def person_public(p: Person) -> PersonPublic:
    return PersonPublic(id=p.id, name=p.name, position=p.position, two_step=p.totp_enabled, has_password=bool(p.password_hash))

class SessionToken(SQLModel, table=True):
    """One signed-in browser or phone. The cookie holds the token; only its hash is stored."""
    id: str = Field(primary_key=True)
    person_id: int | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime
    last_seen: datetime = Field(default_factory=utcnow)
    label: str = Field(default="")
