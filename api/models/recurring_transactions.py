from typing import List, Literal
from uuid import UUID, uuid4
from datetime import date, datetime
from decimal import Decimal
from pydantic import model_validator
from sqlalchemy import Column, JSON, Numeric
from sqlmodel import SQLModel, Field, String
from dateutil.relativedelta import relativedelta

from ..util import utcnow

Frequency = Literal["daily", "weekly", "monthly", "yearly"]

class RecurringTransactionBase(SQLModel):
    name: str = Field(default="", index=True)
    category: str = Field(index=True)
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    amount: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    type: Literal["expense", "income"] = Field(sa_type=String, default="expense", index=True)
    startDate: date = Field(default_factory=date.today, index=True)
    # None means it never ends
    endDate: date | None = Field(default=None, index=True)
    frequency: Frequency = Field(sa_type=String, default="monthly", index=True)
    # Every N days, weeks, months or years
    interval: int = Field(default=1)
    person_id: int | None = Field(default=None)
    shares: dict[str, int] | None = Field(default=None, sa_column=Column(JSON))
    paid_by: int | None = Field(default=None)
    # Bills that vary, like electricity, are saved with their average and shown as "about"
    about: bool = Field(default=False)
    note: str = Field(default="")

    @model_validator(mode='after')
    def check_model(self):
        # Check amount
        if self.amount <= 0:
            raise ValueError("amount must be positive")
        if not 1 <= self.interval <= 999:
            raise ValueError("interval must be between 1 and 999")

        # Check endDate
        if self.endDate is not None:
            if self.endDate < self.startDate:
                raise ValueError("endDate must be on or after startDate")
            if self.endDate > (self.startDate + relativedelta(years=100)):
                raise ValueError("endDate cannot be more than 100 years after startDate")

        # Return self
        return self

class RecurringTransaction(RecurringTransactionBase, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    created_date: datetime = Field(default_factory=utcnow, index=True)
    paused: bool = Field(default=False)
    # The last date the engine turned into transactions
    last_run: date | None = Field(default=None)
    # The day of the month a monthly or yearly rule falls on, when it started on a shorter
    # month's last day after a change "from the next charge"
    anchor_day: int | None = Field(default=None)
    # Dates skipped while paused, offered once in "Wally noticed"
    missed: list[str] | None = Field(default=None, sa_column=Column(JSON))

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
    frequency: Frequency | None = None
    interval: int | None = None
    person_id: int | None = None
    shares: dict[str, int] | None = None
    paid_by: int | None = None
    about: bool | None = None
    note: str | None = None
    # "later": from the next charge on (ends this rule, starts a new one).
    # "all": also rewrites the transactions it already made.
    applyTo: Literal["later", "future", "all"] = Field(default="later")

class RecurringTransactionDelete(SQLModel):
    # "future" keeps past transactions; "all" deletes them too
    applyTo: Literal["future", "all"] = Field(default="future")

class RecurringTransactionPublic(SQLModel):
    id: UUID
    name: str
    category: str
    tags: List[str]
    amount: Decimal
    type: Literal["expense", "income"]
    startDate: date
    endDate: date | None
    frequency: Frequency
    interval: int
    person_id: int | None
    shares: dict[str, int] | None
    paid_by: int | None
    about: bool
    note: str
    paused: bool
    last_run: date | None
    anchor_day: int | None
    missed: list[str] | None
    created_date: datetime
