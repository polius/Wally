"""Settle up, budgets (2.1) and savings goals (2.2)."""
from typing import Literal
from datetime import date as d, datetime
from decimal import Decimal
from pydantic import model_validator
from sqlalchemy import Column, Numeric
from sqlmodel import SQLModel, Field, String

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

class BudgetBase(SQLModel):
    category: str
    amount: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    kind: Literal["fixed", "flexible", "yearly"] = Field(sa_type=String, default="flexible")
    rollover: bool = Field(default=False)

    @model_validator(mode='after')
    def check_model(self):
        if self.amount <= 0:
            raise ValueError("amount must be positive")
        return self

class Budget(BudgetBase, table=True):
    id: int | None = Field(default=None, primary_key=True)

class BudgetCreate(BudgetBase):
    pass

class GoalBase(SQLModel):
    name: str = Field(min_length=1, max_length=60)
    target: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    due: d | None = Field(default=None)
    person_id: int | None = Field(default=None)

    @model_validator(mode='after')
    def check_model(self):
        if self.target <= 0:
            raise ValueError("target must be positive")
        return self

class Goal(GoalBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    position: int = Field(default=0)
    done: bool = Field(default=False)
    created_at: datetime = Field(default_factory=utcnow)

class GoalCreate(GoalBase):
    pass

class GoalEntry(SQLModel, table=True):
    """Money put into (or taken out of) a savings goal."""
    id: int | None = Field(default=None, primary_key=True)
    goal_id: int = Field(index=True)
    date: d
    amount: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    person_id: int | None = Field(default=None)
    created_at: datetime = Field(default_factory=utcnow)

class GoalEntryCreate(SQLModel):
    date: d
    amount: Decimal
    person_id: int | None = None

    @model_validator(mode='after')
    def check_model(self):
        if self.amount == 0:
            raise ValueError("amount cannot be zero")
        return self

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
