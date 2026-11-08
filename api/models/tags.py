from sqlmodel import SQLModel, Field

from .categories import IconId

class TagBase(SQLModel):
    name: str = Field(primary_key=True)

class Tag(TagBase, table=True):
    pass

class TagIcon(SQLModel, table=True):
    """The icon someone picked for a tag. Without one, the tag shows the plain tag icon."""
    name: str = Field(primary_key=True)
    icon: str

class TagCreate(TagBase):
    pass

class TagUpdate(SQLModel):
    name: str | None = None
    icon: IconId | None = None

class TagPublic(TagBase):
    icon: str | None = None
