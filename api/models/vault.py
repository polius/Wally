"""End-to-end encryption: what the server keeps when the household turns it on.

The server never sees a password, a key or a figure. It keeps sealed records it cannot open,
each person's household key locked under their password and under their recovery key, and
one-use codes that let someone back in. Every table here is new, so no upgrade step is needed.
"""
from datetime import datetime
from sqlalchemy import Column, LargeBinary
from sqlmodel import SQLModel, Field

from ..util import utcnow

class Kdf(SQLModel, table=True):
    """The salt a person's browser turns their password into keys with (Argon2id).

    With a salt, the browser never sends the password itself: it sends a login key made from it,
    and the server keeps a bcrypt hash of that. The salt stays when encryption is turned off, so
    passwords keep working as they are."""
    person_id: int = Field(primary_key=True)
    salt: str

class VaultKey(SQLModel, table=True):
    """The household key, locked once under the person's password and once under their recovery key."""
    person_id: int = Field(primary_key=True)
    wrap: str
    recovery_hash: str | None = Field(default=None)
    recovery_wrap: str | None = Field(default=None)
    recovery_made: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)

class Invite(SQLModel, table=True):
    """A one-use code for one person: their first way in, or a way back in made by someone else.
    One per person at most; a new one replaces the old."""
    person_id: int = Field(primary_key=True)
    # "invite": they have never unlocked Wally. "help": they had, and lost both password and recovery key.
    kind: str
    login_hash: str
    wrap: str
    created_by: int | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime
    failures: int = Field(default=0)

class Record(SQLModel, table=True):
    """One sealed piece of the household's data: a transaction, a rule, a category, a tag or an import rule.
    The server sees only an id, a version, when it changed and how big it is."""
    id: str = Field(primary_key=True)
    version: int
    # One counter for the household, raised by one for every batch of changes
    seq: int = Field(index=True)
    ct: bytes | None = Field(default=None, sa_column=Column(LargeBinary))
    deleted: bool = Field(default=False)
    updated_at: datetime = Field(default_factory=utcnow)

class VaultEvent(SQLModel, table=True):
    """Something everyone should know about, such as "Sam helped Alex back in"."""
    id: int | None = Field(default=None, primary_key=True)
    kind: str
    person_id: int | None = Field(default=None)
    by: int | None = Field(default=None)
    at: datetime = Field(default_factory=utcnow)
