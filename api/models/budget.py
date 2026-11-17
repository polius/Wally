"""Limits: what a household means to spend on a category, or on everything, each month or each year.

A limit lasts until it is changed or removed. A change made in a month applies from that month on,
and earlier months keep the limit they had: each change ends one row (until) and starts another
(since). The browser works out every figure from these rows, the ledger and the recurring rules."""
from decimal import Decimal
from uuid import uuid4
from sqlalchemy import Column, Numeric
from sqlmodel import SQLModel, Field

class Budget(SQLModel, table=True):
    id: str = Field(default_factory=lambda: uuid4().hex, primary_key=True)
    category: str = Field(default="")         # "" is everything
    period: str = Field(default="month")      # "month" or "year"
    amount: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    since: str                                # YYYY-MM: the first month it applies
    until: str | None = Field(default=None)   # YYYY-MM: the last month it applies; None while it still does
