import secrets
from sqlmodel import SQLModel, Field

DEFAULT_CONFIG = {
    "SECRET_KEY": secrets.token_hex(32),
    "LOGIN_PAGE": False,
    "LOGIN_PASSWORD": "",
    "LOGIN_TOKEN": "",
    "SELECTED_CURRENCY": "EUR",
    "CURRENCY_POSITION": "right",
    "LANGUAGE": "en",
    "BUDGET_WARNING_THRESHOLD": "80",
}

class AppConfig(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
