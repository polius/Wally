from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Column, Numeric, UniqueConstraint
from sqlmodel import SQLModel, Field


class SubscriptionPriceAlertBase(SQLModel):
    recurring_id: str = Field(index=True)
    name: str
    category: str
    frequency: str
    # Date of the charge that was more expensive
    charge_date: date
    # Usual price before the increase and the new price
    previous_amount: Decimal = Field(sa_column=Column(Numeric(10, 2), nullable=False))
    new_amount: Decimal = Field(sa_column=Column(Numeric(10, 2), nullable=False))
    created_at: datetime = Field(default_factory=datetime.now)
    dismissed: bool = Field(default=False)


class SubscriptionPriceAlert(SubscriptionPriceAlertBase, table=True):
    # One alert per subscription charge.
    __table_args__ = (
        UniqueConstraint("recurring_id", "charge_date", name="uq_subscription_price_alert_charge"),
    )

    id: int | None = Field(default=None, primary_key=True)


class SubscriptionPriceAlertPublic(SubscriptionPriceAlertBase):
    id: int
