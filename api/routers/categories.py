from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select, func
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from ..database import get_session
from ..models.categories import Category, CategoryCreate, CategoryPublic, CategoryUpdate
from ..models.transactions import Transaction
from ..models.recurring_transactions import RecurringTransaction
from ..models.money import ImportRule
from .auth import check_login

router = APIRouter(tags=["Categories"], dependencies=[Depends(check_login)])

@router.get("/categories", response_model=list[str])
def read_categories(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(Category).order_by(Category.name)
    categories = db.exec(statement).all()
    return sorted([c.name for c in categories], key=str.lower)

@router.get("/categories/stats")
def category_stats(
    db: Annotated[Session, Depends(get_session)]
):
    """Every category with how many transactions use it."""
    counts = dict(db.exec(select(Transaction.category, func.count()).group_by(Transaction.category)).all())
    names = sorted({c.name for c in db.exec(select(Category)).all()}, key=str.lower)
    return [{"name": n, "count": counts.get(n, 0)} for n in names]

@router.post("/categories", response_model=CategoryPublic)
def create_category(
    category: CategoryCreate,
    db: Annotated[Session, Depends(get_session)]
):
    new_category = Category.model_validate(category)
    db.add(new_category)
    try:
        db.commit()
        db.refresh(new_category)
        return new_category
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="This category already exists.")

@router.put("/categories/{category_name}", response_model=CategoryPublic)
def update_category(
    category_name: str,
    category_update: CategoryUpdate,
    db: Annotated[Session, Depends(get_session)]
):
    category = db.get(Category, category_name)
    if not category:
        raise HTTPException(status_code=404, detail="This category does not exist.")
    
    new_category_name = category_update.name
    
    # Update all transactions that use this category
    statement = select(Transaction).where(Transaction.category == category_name)
    transactions = db.exec(statement).all()
    for transaction in transactions:
        transaction.category = new_category_name
        db.add(transaction)
    
    # Update all recurring transactions that use this category
    statement = select(RecurringTransaction).where(RecurringTransaction.category == category_name)
    recurring_transactions = db.exec(statement).all()
    for recurring_transaction in recurring_transactions:
        recurring_transaction.category = new_category_name
        db.add(recurring_transaction)
    
    # Import rules follow the category
    db.exec(update(ImportRule).where(ImportRule.category == category_name).values(category=new_category_name))

    # Update the category with new data
    category_data = category_update.model_dump(exclude_unset=True)
    category.sqlmodel_update(category_data)
    
    try:
        db.add(category)
        db.commit()
        db.refresh(category)
        return category
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="A category with this name already exists.")

@router.get("/categories/{category_name}/usage")
def category_usage(
    category_name: str,
    db: Annotated[Session, Depends(get_session)]
):
    """How many transactions and rules use a category, for the delete confirmation."""
    transactions = db.exec(select(func.count()).select_from(Transaction).where(Transaction.category == category_name)).one()
    recurring = db.exec(select(func.count()).select_from(RecurringTransaction).where(RecurringTransaction.category == category_name)).one()
    return {"transactions": transactions, "recurring": recurring}

@router.delete("/categories/{category_name}")
def delete_category(
    category_name: str,
    db: Annotated[Session, Depends(get_session)],
    move_to: str | None = None,
):
    """Delete a category. Transactions and rules using it move to another category first."""
    category = db.get(Category, category_name)
    if not category:
        raise HTTPException(status_code=404, detail="This category does not exist.")

    used = category_usage(category_name, db)
    if used["transactions"] or used["recurring"]:
        if not move_to or move_to == category_name or not db.get(Category, move_to):
            count = used["transactions"]
            raise HTTPException(
                status_code=400,
                detail=f"Cannot delete category. {count} transaction{'s' if count != 1 else ''} {'are' if count != 1 else 'is'} using this category. Choose where to move them."
            )
        db.exec(update(Transaction).where(Transaction.category == category_name).values(category=move_to))
        db.exec(update(RecurringTransaction).where(RecurringTransaction.category == category_name).values(category=move_to))
        db.exec(update(ImportRule).where(ImportRule.category == category_name).values(category=move_to))

    db.delete(category)
    db.commit()
    return {"ok": True}
