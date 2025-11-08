from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError

from ..database import get_session
from ..models.categories import Category, CategoryCreate, CategoryPublic, CategoryUpdate
from ..models.transactions import Transaction
from ..models.recurring_transactions import RecurringTransaction
from .auth import check_login

router = APIRouter(tags=["Categories"], dependencies=[Depends(check_login)])

@router.get("/categories", response_model=list[str])
def read_categories(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(Category).order_by(Category.name)
    categories = db.exec(statement).all()
    return sorted([c.name for c in categories], key=str.lower)

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

@router.delete("/categories/{category_name}")
def delete_category(
    category_name: str,
    db: Annotated[Session, Depends(get_session)]
):
    category = db.get(Category, category_name)
    if not category:
        raise HTTPException(status_code=404, detail="This category does not exist.")
    
    # Check if any transactions are using this category
    statement = select(Transaction).where(Transaction.category == category_name)
    transactions_count = len(db.exec(statement).all())
    
    if transactions_count > 0:
        raise HTTPException(
            status_code=400, 
            detail=f"Cannot delete category. {transactions_count} transaction{'s' if transactions_count != 1 else ''} {'are' if transactions_count != 1 else 'is'} using this category. Please reassign or delete those transactions first."
        )
    
    # Check if any recurring transactions are using this category
    statement = select(RecurringTransaction).where(RecurringTransaction.category == category_name)
    recurring_count = len(db.exec(statement).all())
    
    if recurring_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete category. {recurring_count} recurring transaction{'s' if recurring_count != 1 else ''} {'are' if recurring_count != 1 else 'is'} using this category. Please reassign or delete those recurring transactions first."
        )
    
    db.delete(category)
    db.commit()
    return {"ok": True}
