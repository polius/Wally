from datetime import datetime
from sqlalchemy import Column, JSON
from sqlmodel import SQLModel, Field

from ..util import utcnow

class Person(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    position: int = Field(default=0)
    # Everyone signs in with the household's one password: a person is who you say you are once it is typed
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

def person_public(p: Person) -> PersonPublic:
    return PersonPublic(id=p.id, name=p.name, position=p.position)

class SessionToken(SQLModel, table=True):
    """One signed-in browser or phone. The cookie holds the token; only its hash is stored."""
    id: str = Field(primary_key=True)
    person_id: int | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime
    last_seen: datetime = Field(default_factory=utcnow)
    label: str = Field(default="")
