import secrets
from sqlmodel import SQLModel, Field

DEFAULT_CONFIG = {
    "SECRET_KEY": secrets.token_hex(32),
    "LOGIN_PAGE": False,
    "LOGIN_PASSWORD": "",
    "LOGIN_TOKEN": "",
}

class AppConfig(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
