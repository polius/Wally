from sqlmodel import SQLModel, Field

class PersonBase(SQLModel):
    name: str = Field(primary_key=True)

class Person(PersonBase, table=True):
    pass

class PersonCreate(PersonBase):
    pass

class PersonUpdate(PersonBase):
    pass

class PersonPublic(PersonBase):
    pass
