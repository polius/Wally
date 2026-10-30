"""Settle up and import rules."""
from datetime import date as d, datetime
from decimal import Decimal
from pydantic import model_validator
from sqlalchemy import Column, Numeric
from sqlmodel import SQLModel, Field

from ..util import utcnow

class SettlementBase(SQLModel):
    date: d
    from_person: int
    to_person: int
    amount: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    note: str = Field(default="")

    @model_validator(mode='after')
    def check_model(self):
        if self.amount <= 0:
            raise ValueError("amount must be positive")
        if self.from_person == self.to_person:
            raise ValueError("a payment needs two different people")
        return self

class Settlement(SettlementBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_by: int | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)

class SettlementCreate(SettlementBase):
    pass

class ImportRuleBase(SQLModel):
    match: str = Field(min_length=1, max_length=80)
    category: str
    person_id: int | None = Field(default=None)
    # False leaves the person as the import sets it
    set_person: bool = Field(default=True)

class ImportRule(ImportRuleBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    uses: int = Field(default=0)
    learned: bool = Field(default=False)
    position: int = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow)

class ImportRuleCreate(ImportRuleBase):
    pass
