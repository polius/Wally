import secrets
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field


def generate_person_id() -> str:
    return secrets.token_hex(6)


class Person(SQLModel, table=True):
    id: str = Field(default_factory=generate_person_id, primary_key=True)
    name: str = Field(index=True)
    is_self: bool = Field(default=False)
    created_date: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    )


class PersonCreate(SQLModel):
    name: str


class PersonUpdate(SQLModel):
    name: str | None = None
    is_self: bool | None = None


class PersonPublic(SQLModel):
    id: str
    name: str
    is_self: bool
    created_date: str


class PersonFromTag(SQLModel):
    tag: str
    name: str
