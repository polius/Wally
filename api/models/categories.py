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

class CategoryBase(SQLModel):
    name: str = Field(primary_key=True)

class Category(CategoryBase, table=True):
    pass

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(CategoryBase):
    pass

class CategoryPublic(CategoryBase):
    pass
