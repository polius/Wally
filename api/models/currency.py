from sqlmodel import SQLModel, Field, String
from typing import Literal

# List of default currencies to insert
DEFAULT_CURRENCIES = [
    {"name": "AED", "symbol": "AED", "position": "left", "selected": False},
    {"name": "AUD", "symbol": "A$", "position": "left", "selected": False},
    {"name": "BDT", "symbol": "৳", "position": "left", "selected": False},
    {"name": "BRL", "symbol": "R$", "position": "left", "selected": False},
    {"name": "CAD", "symbol": "C$", "position": "left", "selected": False},
    {"name": "CHF", "symbol": "Fr", "position": "left", "selected": False},
    {"name": "CNY", "symbol": "¥", "position": "left", "selected": False},
    {"name": "DKK", "symbol": "kr.", "position": "right", "selected": False},
    {"name": "EUR", "symbol": "€", "position": "right", "selected": True},
    {"name": "GBP", "symbol": "£", "position": "left", "selected": False},
    {"name": "HKD", "symbol": "HK$", "position": "left", "selected": False},
    {"name": "IDR", "symbol": "Rp", "position": "left", "selected": False},
    {"name": "ILS", "symbol": "₪", "position": "left", "selected": False},
    {"name": "INR", "symbol": "₹", "position": "left", "selected": False},
    {"name": "JPY", "symbol": "¥", "position": "left", "selected": False},
    {"name": "KRW", "symbol": "₩", "position": "left", "selected": False},
    {"name": "MAD", "symbol": "DH", "position": "right", "selected": False},
    {"name": "MXN", "symbol": "Mex$", "position": "left", "selected": False},
    {"name": "MYR", "symbol": "RM", "position": "left", "selected": False},
    {"name": "NZD", "symbol": "NZ$", "position": "left", "selected": False},
    {"name": "PHP", "symbol": "₱", "position": "left", "selected": False},
    {"name": "PLN", "symbol": "zł", "position": "right", "selected": False},
    {"name": "RUB", "symbol": "₽", "position": "left", "selected": False},
    {"name": "SEK", "symbol": "kr", "position": "right", "selected": False},
    {"name": "SGD", "symbol": "S$", "position": "left", "selected": False},
    {"name": "THB", "symbol": "฿", "position": "left", "selected": False},
    {"name": "TRY", "symbol": "₺", "position": "left", "selected": False},
    {"name": "USD", "symbol": "$", "position": "left", "selected": False},
    {"name": "VND", "symbol": "₫", "position": "right", "selected": False},
    {"name": "ZAR", "symbol": "R", "position": "left", "selected": False},
]

class CurrencyBase(SQLModel):
    name: str = Field(primary_key=True)
    symbol: str
    position: Literal["left", "right"] = Field(sa_type=String, index=True)
    selected: bool = Field(index=True)

class Currency(CurrencyBase, table=True):
    pass

class CurrencyPublic(CurrencyBase):
    pass
