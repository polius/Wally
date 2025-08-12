from sqlmodel import SQLModel, Field

class TagBase(SQLModel):
    name: str = Field(primary_key=True)

class Tag(TagBase, table=True):
    pass

class TagCreate(TagBase):
    pass

class TagPublic(TagBase):
    pass
