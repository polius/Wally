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
    # Added in 2.0
    "REQUIRE_TWO_STEP": False,
    "SAVINGS_TARGET": "15",
    "TIMEZONE": "",
    "WEEK_START": "mon",
    "OPEN_ON": "dashboard",
    "SAVED_VIEWS": "[]",
    "NIGHTLY_BACKUP": True,
    "LEARN_RULES": True,
    "ONBOARDED": False,
}

# Keys that Settings may change through /config
PUBLIC_KEYS = {
    "SAVINGS_TARGET", "TIMEZONE", "WEEK_START", "OPEN_ON", "SAVED_VIEWS",
    "NIGHTLY_BACKUP", "LEARN_RULES", "ONBOARDED",
}

class AppConfig(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
