from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError

from ..database import get_session
from ..models.tags import Tag, TagCreate, TagPublic, TagUpdate
from ..models.transactions import Transaction
from ..models.recurring_transactions import RecurringTransaction
from .auth import check_login

router = APIRouter(tags=["Tags"], dependencies=[Depends(check_login)])

@router.get("/tags", response_model=list[str])
def read_tags(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(Tag).order_by(Tag.name)
    tags = db.exec(statement).all()
    return sorted([t.name for t in tags], key=str.lower)

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
        return new_tag
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
    
    new_tag_name = tag_update.name
    
    # Update all transactions that use this tag
    statement = select(Transaction)
    transactions = db.exec(statement).all()
    for transaction in transactions:
        if tag_name in transaction.tags:
            # Replace the old tag name with the new one
            transaction.tags = [new_tag_name if t == tag_name else t for t in transaction.tags]
            db.add(transaction)
    
    # Update all recurring transactions that use this tag
    statement = select(RecurringTransaction)
    recurring_transactions = db.exec(statement).all()
    for recurring_transaction in recurring_transactions:
        if tag_name in recurring_transaction.tags:
            # Replace the old tag name with the new one
            recurring_transaction.tags = [new_tag_name if t == tag_name else t for t in recurring_transaction.tags]
            db.add(recurring_transaction)
    
    # Update the tag with new data
    tag_data = tag_update.model_dump(exclude_unset=True)
    tag.sqlmodel_update(tag_data)
    
    try:
        db.add(tag)
        db.commit()
        db.refresh(tag)
        return tag
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
    
    db.delete(tag)
    db.commit()
    return {"ok": True}
