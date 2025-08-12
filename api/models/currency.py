from sqlmodel import SQLModel, Field, String
from typing import Literal

# List of default currencies to insert
DEFAULT_CURRENCIES = [
    {"name": "EUR", "symbol": "€", "position": "right", "selected": True},
    {"name": "USD", "symbol": "$", "position": "left", "selected": False},
    {"name": "GBP", "symbol": "£", "position": "left", "selected": False},
    {"name": "JPY", "symbol": "¥", "position": "left", "selected": False},
]

class CurrencyBase(SQLModel):
    name: str = Field(primary_key=True)
    symbol: str = Field(unique=True)
    position: Literal["left", "right"] = Field(sa_type=String, index=True)
    selected: bool = Field(index=True)

class Currency(CurrencyBase, table=True):
    pass

class CurrencyPublic(CurrencyBase):
    pass
