from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError

from ..database import get_session
from ..models.tags import Tag, TagIcon, TagCreate, TagPublic, TagUpdate
from ..models.transactions import Transaction
from ..models.recurring_transactions import RecurringTransaction
from .auth import check_login
from .categories import set_icon

router = APIRouter(tags=["Tags"], dependencies=[Depends(check_login)])

@router.get("/tags", response_model=list[str])
def read_tags(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(Tag).order_by(Tag.name)
    tags = db.exec(statement).all()
    return sorted([t.name for t in tags], key=str.lower)

def public(db: Session, name: str) -> TagPublic:
    icon = db.get(TagIcon, name)
    return TagPublic(name=name, icon=icon.icon if icon else None)

@router.get("/tags/icons")
def tag_icons(
    db: Annotated[Session, Depends(get_session)]
):
    """{name: icon} for the tags whose icon someone picked."""
    return {t.name: t.icon for t in db.exec(select(TagIcon)).all()}

@router.get("/tags/stats")
def tag_stats(
    db: Annotated[Session, Depends(get_session)]
):
    """Every tag with how many transactions use it."""
    counts: dict[str, int] = {}
    for tags in db.exec(select(Transaction.tags)).all():
        for tag in tags or []:
            counts[tag] = counts.get(tag, 0) + 1
    names = sorted({t.name for t in db.exec(select(Tag)).all()} | set(counts), key=str.lower)
    return [{"name": n, "count": counts.get(n, 0)} for n in names]

@router.post("/tags", response_model=TagPublic)
def create_tag(
    tag: TagCreate,
    db: Annotated[Session, Depends(get_session)]
):
    new_tag = Tag.model_validate(tag)
    db.add(new_tag)
    try:
        db.commit()
        db.refresh(new_tag)
        return public(db, new_tag.name)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="This tag already exists.")

@router.put("/tags/{tag_name}", response_model=TagPublic)
def update_tag(
    tag_name: str,
    tag_update: TagUpdate,
    db: Annotated[Session, Depends(get_session)]
):
    tag = db.get(Tag, tag_name)
    if not tag:
        raise HTTPException(status_code=404, detail="This tag does not exist.")
    
    new_tag_name = tag_update.name.strip().lstrip("#") if tag_update.name is not None else tag_name

    # Only the icon: nothing else changes
    if new_tag_name == tag_name:
        if tag_update.icon is not None:
            set_icon(db, tag_name, tag_update.icon, TagIcon)
            db.commit()
        return public(db, tag_name)

    merge = db.get(Tag, new_tag_name) is not None
    
    # Update all transactions that use this tag
    statement = select(Transaction)
    transactions = db.exec(statement).all()
    for transaction in transactions:
        if tag_name in transaction.tags:
            # Replace the old tag name with the new one
            transaction.tags = list(dict.fromkeys(new_tag_name if t == tag_name else t for t in transaction.tags))
            db.add(transaction)
    
    # Update all recurring transactions that use this tag
    statement = select(RecurringTransaction)
    recurring_transactions = db.exec(statement).all()
    for recurring_transaction in recurring_transactions:
        if tag_name in recurring_transaction.tags:
            # Replace the old tag name with the new one
            recurring_transaction.tags = list(dict.fromkeys(new_tag_name if t == tag_name else t for t in recurring_transaction.tags))
            db.add(recurring_transaction)
    
    # Renaming into a tag that exists merges the two, and that tag keeps its own icon
    old_icon = db.get(TagIcon, tag_name)
    if merge:
        if old_icon:
            db.delete(old_icon)
        db.delete(tag)
        if tag_update.icon is not None:
            set_icon(db, new_tag_name, tag_update.icon, TagIcon)
        db.commit()
        return public(db, new_tag_name)
    
    # The icon moves with the name, then takes the new value
    if old_icon:
        icon = old_icon.icon
        db.delete(old_icon)
        db.flush()
        db.add(TagIcon(name=new_tag_name, icon=icon))
    tag.name = new_tag_name
    if tag_update.icon is not None:
        set_icon(db, new_tag_name, tag_update.icon, TagIcon)
    
    try:
        db.add(tag)
        db.commit()
        db.refresh(tag)
        return public(db, tag.name)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="A tag with this name already exists.")

@router.delete("/tags/{tag_name}")
def delete_tag(
    tag_name: str,
    db: Annotated[Session, Depends(get_session)]
):
    tag = db.get(Tag, tag_name)
    if not tag:
        raise HTTPException(status_code=404, detail="This tag does not exist.")
    
    # Remove the tag from all transactions
    statement = select(Transaction)
    transactions = db.exec(statement).all()
    for transaction in transactions:
        if tag_name in transaction.tags:
            # Remove this tag from the tags list
            transaction.tags = [t for t in transaction.tags if t != tag_name]
            db.add(transaction)
    
    # Remove the tag from all recurring transactions
    statement = select(RecurringTransaction)
    recurring_transactions = db.exec(statement).all()
    for recurring_transaction in recurring_transactions:
        if tag_name in recurring_transaction.tags:
            # Remove this tag from the tags list
            recurring_transaction.tags = [t for t in recurring_transaction.tags if t != tag_name]
            db.add(recurring_transaction)
    
    icon = db.get(TagIcon, tag_name)
    if icon:
        db.delete(icon)
    db.delete(tag)
    db.commit()
    return {"ok": True}
