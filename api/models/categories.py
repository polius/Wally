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

# A category's color isn't stored: the app gives it from the category's place in all-time spending
# (biggest red, then on through the rainbow). Income is always green.

class CategoryBase(SQLModel):
    name: str = Field(primary_key=True)

class Category(CategoryBase, table=True):
    pass

class CategoryColor(SQLModel, table=True):
    """Colors picked before they followed spending. No longer read or written; the table stays so
    backups and older households keep the same tables."""
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
    icon: IconId | None = None

class CategoryUpdate(SQLModel):
    name: str | None = None
    icon: IconId | None = None

class CategoryPublic(CategoryBase):
    icon: str | None = None
