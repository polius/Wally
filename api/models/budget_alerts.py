from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Column, Numeric, UniqueConstraint
from sqlmodel import SQLModel, Field

# Alert levels
WARNING = "warning"
OVER_BUDGET = "over_budget"

DEFAULT_WARNING_THRESHOLD = 80


class BudgetAlertBase(SQLModel):
    category: str = Field(index=True)
    period: str
    window_start: date
    window_end: date
    level: str
    # Percentage that triggered the alert (e.g. 80 or 100)
    threshold: int
    spent: Decimal = Field(sa_column=Column(Numeric(10, 2), nullable=False))
    limit: Decimal = Field(sa_column=Column(Numeric(10, 2), nullable=False))
    created_at: datetime = Field(default_factory=datetime.now)
    dismissed: bool = Field(default=False)


class BudgetAlert(BudgetAlertBase, table=True):
    # One alert per budget, period window and level.
    __table_args__ = (
        UniqueConstraint("category", "period", "window_start", "level", name="uq_budget_alert_window_level"),
    )

    id: int | None = Field(default=None, primary_key=True)


class BudgetAlertPublic(BudgetAlertBase):
    id: int


class BudgetAlertSettings(SQLModel):
    # 100% is reserved for the over-budget alert.
    warning_threshold: int = Field(ge=1, le=99)
