from typing import List, Literal
from uuid import UUID, uuid4
from datetime import date as d, datetime as dt
from decimal import Decimal
from pydantic import model_validator
from sqlalchemy import Column, JSON, Numeric
from sqlmodel import SQLModel, Field, String

from ..util import utcnow

class TransactionBase(SQLModel):
    name: str = Field(default="", index=True)
    category: str = Field(index=True)
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    amount: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    type: Literal["expense", "income"] = Field(sa_type=String, default="expense", index=True)
    date: d = Field(default_factory=d.today, index=True)
    # Who it belongs to. None is shared by the household, split by `shares`.
    person_id: int | None = Field(default=None, index=True)
    # Each person's part of a shared transaction, in cents. Always adds up to the amount.
    shares: dict[str, int] | None = Field(default=None, sa_column=Column(JSON))
    # Who paid a shared cost, to work out who owes whom
    paid_by: int | None = Field(default=None)
    note: str = Field(default="")

    @model_validator(mode='after')
    def check_model(self):
        # Check amount
        if self.amount <= 0:
            raise ValueError("amount must be positive")
        if self.amount >= Decimal("100000000"):
            raise ValueError("amount is too large")
        self.name = self.name.strip()
        return self

class Transaction(TransactionBase, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    recurringID: str = Field(default="", index=True)
    created_date: dt = Field(default_factory=utcnow, index=True)
    created_by: int | None = Field(default=None)
    # Hash of the bank row it was imported from, so a second import skips it
    import_ref: str | None = Field(default=None, index=True)
    # The bank's name and date, when an import matched something typed by hand
    source: dict | None = Field(default=None, sa_column=Column(JSON))
    # Parts of one receipt split across categories share a group
    group_id: str | None = Field(default=None, index=True)

class TransactionCreate(TransactionBase):
    group_id: str | None = None

class TransactionRestore(TransactionCreate):
    """A deleted transaction put back by Undo, with its original id."""
    id: UUID
    recurringID: str = ""
    import_ref: str | None = None
    source: dict | None = None
    created_by: int | None = None
    # Kept, so the transaction returns to its place among the day's others
    created_date: dt | None = None

class TransactionUpdate(SQLModel):
    name: str | None = None
    category: str | None = None
    tags: List[str] | None = None
    amount: Decimal | None = None
    type: Literal["expense", "income"] | None = None
    date: d | None = None
    person_id: int | None = None
    shares: dict[str, int] | None = None
    paid_by: int | None = None
    note: str | None = None

class TransactionPublic(SQLModel):
    id: UUID
    recurringID: str
    name: str
    category: str
    tags: List[str]
    amount: Decimal
    type: Literal["expense", "income"]
    date: d
    person_id: int | None
    shares: dict[str, int] | None
    paid_by: int | None
    note: str
    created_by: int | None
    created_date: dt
    import_ref: str | None
    source: dict | None
    group_id: str | None

class BulkAction(SQLModel):
    ids: list[UUID]
    action: Literal["delete", "update"]
    category: str | None = None
    person_id: int | None = None
    # Set person_id even when it is None (shared)
    set_person: bool = False
