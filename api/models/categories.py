from typing import Optional
from decimal import Decimal
from sqlalchemy import Column, Numeric
from sqlmodel import SQLModel, Field

DEFAULT_CATEGORIES = [
    {"name": "Entertainment"},
    {"name": "Food"},
    {"name": "Groceries"},
    {"name": "Healthcare"},
    {"name": "Income"},
    {"name": "Miscellaneous"},
    {"name": "Rent"},
    {"name": "Shopping"},
    {"name": "Travel"},
    {"name": "Utilities"},
]

class CategoryBase(SQLModel):
    name: str = Field(primary_key=True)

class Category(CategoryBase, table=True):
    budget: Optional[Decimal] = Field(default=None, sa_column=Column(Numeric(10, 2), nullable=True))

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(CategoryBase):
    pass

class CategoryPublic(SQLModel):
    name: str
    budget: Optional[Decimal] = None

class CategoryBudgetUpdate(SQLModel):
    budget: Optional[Decimal] = None
