from typing import List, Literal
from uuid import UUID, uuid4
from datetime import date as d, datetime as dt
from decimal import Decimal
from pydantic import model_validator
from sqlalchemy import Column, JSON, Numeric
from sqlmodel import SQLModel, Field, String


class TransactionShare(SQLModel):
    person_id: str
    amount: Decimal


class TransactionBase(SQLModel):
    name: str = Field(default="", index=True)
    category: str = Field(index=True)
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    amount: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    type: Literal["expense", "income"] = Field(sa_type=String, default="expense", index=True)
    date: d = Field(default_factory=d.today, index=True)
    # The owner is a real field, not a tag. Null means "no owner"; a shared
    # transaction is also null but carries `shares` on the table row.
    person_id: str | None = Field(default=None, index=True)

    @model_validator(mode='after')
    def check_model(self):
        if self.amount <= 0:
            raise ValueError("amount must be positive")
        return self


class Transaction(TransactionBase, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    recurringID: str = Field(default="", index=True)
    created_date: dt = Field(default_factory=dt.now, index=True)
    # Shares are only written for a shared transaction (person_id is null).
    # Stored as JSON so a row is self-contained and the balance maths needs no
    # second query. Amounts are strings to keep exact cents in JSON.
    shares: List[dict] = Field(default_factory=list, sa_column=Column(JSON))


class TransactionCreate(TransactionBase):
    shares: List[TransactionShare] = Field(default_factory=list)


class TransactionUpdate(SQLModel):
    name: str | None = None
    category: str | None = None
    tags: List[str] | None = None
    amount: Decimal | None = None
    type: Literal["expense", "income"] | None = None
    date: d | None = None
    person_id: str | None = None
    shares: List[TransactionShare] | None = None


class TransactionPublic(SQLModel):
    id: UUID
    recurringID: str
    name: str
    category: str
    tags: List[str]
    amount: Decimal
    type: Literal["expense", "income"]
    date: d
    created_date: dt
    person_id: str | None = None
    shares: List[TransactionShare] = Field(default_factory=list)
