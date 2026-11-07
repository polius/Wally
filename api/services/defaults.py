"""The categories a new household starts with, in the household's language.

They're added when the database is new, in the language set then (English on a new server). Setup
asks for the language first: until the household is set up, changing it gives the starting
categories the new language's names, as long as they're still exactly as they were added and
nothing uses them. After that they're the household's own, and keep the names they have.
"""
from sqlmodel import Session, select

from ..database import STATE
from ..models.app import AppConfig
from ..models.categories import Category, CategoryIcon, DEFAULT_NAMES, default_categories
from ..models.money import ImportRule
from ..models.recurring_transactions import RecurringTransaction
from ..models.transactions import Transaction

def _language(db: Session) -> str:
    row = db.get(AppConfig, "LANGUAGE")
    return row.value if row else "en"

def seed(db: Session):
    """A new database: the starting categories, in the household's language."""
    if STATE.get("vault") or db.exec(select(Category).limit(1)).first():
        return
    db.bulk_insert_mappings(Category, default_categories(_language(db)))
    db.commit()

def untouched(db: Session) -> bool:
    """Are the categories still the starting ones, in one language, as they were added, with nothing using them?"""
    names = {c.name for c in db.exec(select(Category)).all()}
    if not any(names == set(v) for v in DEFAULT_NAMES.values()):
        return False
    for model in (Transaction, RecurringTransaction, ImportRule, CategoryIcon):
        if db.exec(select(model).limit(1)).first():
            return False
    return True

def follow_language(db: Session, language: str):
    """During setup, the starting categories take the language just picked. The caller commits."""
    onboarded = db.get(AppConfig, "ONBOARDED")
    if STATE.get("vault") or STATE.get("read_only") or (onboarded and onboarded.value in ("1", "true", "True")):
        return
    if not untouched(db):
        return
    want = default_categories(language)
    if {c.name for c in db.exec(select(Category)).all()} == {c["name"] for c in want}:
        return
    for c in db.exec(select(Category)).all():
        db.delete(c)
    db.flush()
    db.bulk_insert_mappings(Category, want)
