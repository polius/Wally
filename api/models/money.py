"""Import rules: what a bank's text sets on import."""
from datetime import date as d, datetime
from decimal import Decimal
from pydantic import model_validator
from sqlalchemy import Column, Numeric
from sqlmodel import SQLModel, Field

from ..util import utcnow

class ImportRuleBase(SQLModel):
    match: str = Field(min_length=1, max_length=80)
    category: str
    person_id: int | None = Field(default=None)
    # False leaves the person as the import sets it
    set_person: bool = Field(default=True)

class ImportRule(ImportRuleBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    uses: int = Field(default=0)
    learned: bool = Field(default=False)
    position: int = Field(default=0)
    created_at: datetime = Field(default_factory=utcnow)

class ImportRuleCreate(ImportRuleBase):
    pass
