from decimal import Decimal
from pydantic import field_validator
from sqlalchemy import Column, Numeric
from sqlmodel import SQLModel, Field

class BudgetBase(SQLModel):
    category: str = Field(primary_key=True)
    limit: Decimal = Field(
        gt=0,
        sa_column=Column(Numeric(10, 2), nullable=False)
    )
    period: str

    @field_validator("period")
    @classmethod
    def validate_period(cls, value):
        if value not in {"weekly", "monthly"}:
            raise ValueError("period must be 'weekly' or 'monthly'")
        return value

class Budget(BudgetBase, table=True):
    pass

class BudgetCreate(BudgetBase):
    pass

class BudgetUpdate(SQLModel):
    limit: Decimal | None = Field(default=None, gt=0)
    period: str | None = None

    @field_validator("period")
    @classmethod
    def validate_period(cls, value):
        if value is not None and value not in {"weekly", "monthly"}:
            raise ValueError("period must be 'weekly' or 'monthly'")
        return value


class BudgetPublic(BudgetBase):
    pass
