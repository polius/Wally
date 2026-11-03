from typing import Annotated
from pydantic import StringConstraints
from sqlmodel import SQLModel, Field

DEFAULT_CATEGORIES = [
    {"name": "Entertainment"},
    {"name": "Food"},
    {"name": "Groceries"},
    {"name": "Healthcare"},
    {"name": "Income"},
    {"name": "Miscellaneous"},
    {"name": "Rent"},
    {"name": "Shopping"},
    {"name": "Travel"},
    {"name": "Utilities"},
]

# A category keeps one of eight colors for good (1 red, 2 orange, 3 yellow, 4 green, 5 cyan,
# 6 blue, 7 violet, 8 pink), or grey (9) once all eight are taken. Income is always green and has none.
COLORS = range(1, 9)
GREY = 9

class CategoryBase(SQLModel):
    name: str = Field(primary_key=True)

class Category(CategoryBase, table=True):
    pass

class CategoryColor(SQLModel, table=True):
    """Kept apart from Category so the category table stays as Wally 1.x made it."""
    name: str = Field(primary_key=True)
    color: int

class CategoryIcon(SQLModel, table=True):
    """The icon someone picked. Without one, the app picks it from the name."""
    name: str = Field(primary_key=True)
    icon: str

# An icon's id: one of the app's own, or "l-" and the name of one of Lucide's. "" goes back to the one
# picked from the name.
IconId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{0,64}$")]

class CategoryCreate(CategoryBase):
    color: int | None = Field(default=None, ge=1, le=9)
    icon: IconId | None = None

class CategoryUpdate(SQLModel):
    name: str | None = None
    color: int | None = Field(default=None, ge=1, le=9)
    icon: IconId | None = None

class CategoryPublic(CategoryBase):
    color: int | None = None
    icon: str | None = None
