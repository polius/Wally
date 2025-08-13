import bcrypt
from sqlmodel import SQLModel, Field

DEFAULT_USERS = [
    {
        "username": "admin",
        "password": bcrypt.hashpw('admin'.encode('utf-8'), bcrypt.gensalt()).decode(),
        "admin": True,
    },
    {
        "username": "user",
        "password": bcrypt.hashpw('user'.encode('utf-8'), bcrypt.gensalt()).decode(),
        "admin": False,
    },
]

class UserBase(SQLModel):
    username: str = Field(primary_key=True)
    password: str
    admin: bool = Field(default=False, index=True)

class User(UserBase, table=True):
    pass

class UserCreate(UserBase):
    pass

class UserUpdate(UserBase):
    username: str
    password: str | None = None
    admin: bool = False

class UserPublic(SQLModel):
    username: str
    admin: bool
