from datetime import datetime
from sqlmodel import SQLModel, Field

DEFAULT_USERS = [
    {
        "username": "admin",
        "password": "admin",
        "admin": True,
        "created_date": datetime.now(),
    },
    {
        "username": "user",
        "password": "user",
        "admin": False,
        "created_date": datetime.now(),
    },
]

class UserBase(SQLModel):
    username: str = Field(primary_key=True)
    password: str
    admin: bool = Field(default=False, index=True)
    created_date: datetime = Field(default_factory=datetime.now, index=True)

class User(UserBase, table=True):
    pass

class UserCreate(SQLModel):
    username: str
    password: str
    admin: bool = False

class UserUpdate(SQLModel):
    password: str

class UserPublic(SQLModel):
    username: str
    admin: bool
    created_date: datetime
