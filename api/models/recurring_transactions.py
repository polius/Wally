from typing import List, Literal
from uuid import UUID, uuid4
from datetime import date, datetime, timedelta
from decimal import Decimal
from pydantic import field_validator
from sqlalchemy import Column, JSON, Numeric
from sqlmodel import SQLModel, Field, String
from dateutil.relativedelta import relativedelta

class RecurringTransactionBase(SQLModel):
    name: str = Field(index=True)
    category: str = Field(index=True)
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    amount: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    type: Literal["expense", "income"] = Field(sa_type=String, default="expense", index=True)
    startDate: date = Field(default_factory=date.today, index=True)
    endDate: date = Field(default_factory=date.today, index=True)
    interval: Literal["daily","weekly","monthly","yearly"] = Field(sa_type=String, default="daily", index=True)

    @field_validator("amount")
    def amount_must_be_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("amount must be positive")
        return v

    @field_validator("startDate")
    def check_start_date(cls, v: date) -> date:
        today = date.today()
        if v < today:
            raise ValueError("startDate must be today or later")
        return v

    @field_validator("endDate")
    def check_end_date(cls, v: date, info) -> date:
        start_date = info.data["startDate"]
        if v <= start_date:
            raise ValueError("endDate must be after startDate")

        max_end = start_date + relativedelta(years=100)
        if v > max_end:
            raise ValueError("endDate cannot be more than 100 years after startDate")

        return v

class RecurringTransaction(RecurringTransactionBase, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    created_date: datetime = Field(default_factory=datetime.now, index=True)

class RecurringTransactionCreate(RecurringTransactionBase):
    pass

class RecurringTransactionUpdate(SQLModel):
    name: str | None = None
    category: str | None = None
    tags: List[str] | None = None
    amount: Decimal | None = None
    type: Literal["expense", "income"] | None = None
    startDate: date | None = None
    endDate: date | None = None
    interval: Literal["daily","weekly","monthly","yearly"] | None = None

class RecurringTransactionPublic(SQLModel):
    id: UUID
    name: str
    category: str
    tags: List[str]
    amount: Decimal
    type: Literal["expense", "income"]
    startDate: date
    endDate: date
    interval: Literal["daily","weekly","monthly","yearly"]
