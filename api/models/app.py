from sqlmodel import SQLModel, Field

class AppConfig(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str
