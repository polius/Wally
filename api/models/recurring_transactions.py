from typing import List, Literal
from uuid import UUID, uuid4
from datetime import date, datetime
from decimal import Decimal
from pydantic import model_validator
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
    frequency: Literal["daily", "weekly", "monthly", "yearly"] = Field(sa_type=String, default="daily", index=True)
    
    @model_validator(mode='after')
    def check_model(self):
        # Check amount
        if self.amount <= 0:
            raise ValueError("amount must be positive")

        # Check endDate
        if self.endDate <= self.startDate:
            raise ValueError("endDate must be after startDate")

        if self.endDate > (self.startDate + relativedelta(years=100)):
            raise ValueError("endDate cannot be more than 100 years after startDate")

        # Return self        
        return self

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
    frequency: Literal["daily", "weekly", "monthly", "yearly"] | None = None
    applyTo: Literal["future", "all"] = Field(default="future")

class RecurringTransactionDelete(SQLModel):
    applyTo: Literal["future", "all"] = Field(default="future")

class RecurringTransactionPublic(SQLModel):
    id: UUID
    name: str
    category: str
    tags: List[str]
    amount: float
    type: Literal["expense", "income"]
    startDate: date
    endDate: date
    frequency: Literal["daily", "weekly", "monthly", "yearly"]
