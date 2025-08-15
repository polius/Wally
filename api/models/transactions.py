from typing import List, Literal
from uuid import UUID, uuid4
from datetime import date as d, datetime as dt
from decimal import Decimal
from pydantic import model_validator
from sqlalchemy import Column, JSON, Numeric
from sqlmodel import SQLModel, Field, String

class TransactionBase(SQLModel):
    name: str = Field(index=True)
    category: str = Field(index=True)
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    amount: Decimal = Field(sa_column=Column(Numeric(10, 2)))
    type: Literal["expense", "income"] = Field(sa_type=String, default="expense", index=True)
    date: d = Field(default_factory=d.today, index=True)

    @model_validator(mode='after')
    def check_model(self):
        # Check amount
        if self.amount <= 0:
            raise ValueError("amount must be positive")    
        return self

class Transaction(TransactionBase, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    recurringID: str = Field(default="", index=True)
    created_date: dt = Field(default_factory=dt.now, index=True)

class TransactionCreate(TransactionBase):
    pass

class TransactionUpdate(SQLModel):
    name: str | None = None
    category: str | None = None
    tags: List[str] | None = None
    amount: Decimal | None = None
    type: Literal["expense", "income"] | None = None
    date: d | None = None

class TransactionPublic(SQLModel):
    id: UUID
    recurringID: str
    name: str
    category: str
    tags: List[str]
    amount: Decimal
    type: Literal["expense", "income"]
    date: d