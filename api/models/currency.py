from sqlmodel import SQLModel, Field
from typing import Literal
from pydantic import BaseModel

# List of default currencies to insert
DEFAULT_CURRENCIES = [
    {"name": "AED", "symbol": "AED"},
    {"name": "AUD", "symbol": "A$"},
    {"name": "BDT", "symbol": "৳"},
    {"name": "BRL", "symbol": "R$"},
    {"name": "CAD", "symbol": "C$"},
    {"name": "CHF", "symbol": "Fr"},
    {"name": "CNY", "symbol": "¥"},
    {"name": "DKK", "symbol": "kr."},
    {"name": "EUR", "symbol": "€"},
    {"name": "GBP", "symbol": "£"},
    {"name": "HKD", "symbol": "HK$"},
    {"name": "IDR", "symbol": "Rp"},
    {"name": "ILS", "symbol": "₪"},
    {"name": "INR", "symbol": "₹"},
    {"name": "JPY", "symbol": "¥"},
    {"name": "KRW", "symbol": "₩"},
    {"name": "MAD", "symbol": "DH"},
    {"name": "MXN", "symbol": "Mex$"},
    {"name": "MYR", "symbol": "RM"},
    {"name": "NZD", "symbol": "NZ$"},
    {"name": "PHP", "symbol": "₱"},
    {"name": "PLN", "symbol": "zł"},
    {"name": "RUB", "symbol": "₽"},
    {"name": "SEK", "symbol": "kr"},
    {"name": "SGD", "symbol": "S$"},
    {"name": "THB", "symbol": "฿"},
    {"name": "TRY", "symbol": "₺"},
    {"name": "USD", "symbol": "$"},
    {"name": "VND", "symbol": "₫"},
    {"name": "ZAR", "symbol": "R"},
]

class CurrencyBase(SQLModel):
    name: str = Field(primary_key=True)
    symbol: str

class Currency(CurrencyBase, table=True):
    pass

class CurrencyPublic(CurrencyBase):
    pass

class CurrencySettings(BaseModel):
    currencies: list[CurrencyPublic]
    selected: str
    position: Literal["left", "right"]

class CurrencyCreate(BaseModel):
    name: str
    symbol: str

class CurrencyUpdate(BaseModel):
    name: str
    symbol: str
