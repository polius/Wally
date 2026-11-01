"""End-to-end encryption: what the server keeps when the household turns it on.

The server never sees the password, a key or a figure. It keeps sealed records it cannot open,
and the household key locked twice: under the household password and under the recovery key
of the household's Emergency Kit. The salt the password is turned into keys with is a setting
(LOGIN_SALT), so it stays when encryption is turned off. Every table here is new in 2.0.
"""
from datetime import datetime
from sqlalchemy import Column, LargeBinary
from sqlmodel import SQLModel, Field

from ..util import utcnow

class HouseholdKey(SQLModel, table=True):
    """The household key, locked once under the password and once under the recovery key. One row."""
    id: int = Field(default=1, primary_key=True)
    wrap: str
    recovery_hash: str | None = Field(default=None)
    recovery_wrap: str | None = Field(default=None)
    recovery_made: datetime | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)

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
