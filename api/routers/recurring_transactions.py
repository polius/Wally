from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from uuid import UUID
from sqlmodel import Session, select, desc
from sqlalchemy import update, delete
from datetime import timedelta, date
from dateutil.relativedelta import relativedelta

from ..database import get_session
from ..models.transactions import Transaction
from ..models.recurring_transactions import RecurringTransaction, RecurringTransactionCreate, RecurringTransactionUpdate, RecurringTransactionDelete, RecurringTransactionPublic
from .auth import check_login

router = APIRouter(tags=["Recurring Transactions"], dependencies=[Depends(check_login)])

@router.get("/recurring", response_model=list[RecurringTransactionPublic])
def read_recurring_transactions(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(RecurringTransaction).order_by(desc(RecurringTransaction.created_date))
    recurring_transactions = db.exec(statement).all()
    return recurring_transactions

@router.get("/recurring/{recurring_transaction_id}", response_model=list[RecurringTransactionPublic])
def get_recurring_transaction_by_id(
    recurring_transaction_id: UUID,
    db: Annotated[Session, Depends(get_session)]
):
    recurring_transaction = db.get(RecurringTransaction, recurring_transaction_id)
    return [recurring_transaction] if recurring_transaction else []

@router.post("/recurring", response_model=RecurringTransactionPublic)
def create_recurring_transaction(
    recurring_transaction: RecurringTransactionCreate,
    db: Annotated[Session, Depends(get_session)]
):
    new_recurring_transaction = RecurringTransaction.model_validate(recurring_transaction)
    db.add(new_recurring_transaction)

    # Create Transactions for the Recurring Transaction
    create_transactions_from_recurring(new_recurring_transaction, db)

    # Commit the changes to the database
    db.commit()

    # Refresh the new Recurring Transaction
    db.refresh(new_recurring_transaction)

    # Return the created Recurring Transaction
    return new_recurring_transaction

@router.put("/recurring/{recurring_transaction_id}", response_model=RecurringTransactionPublic)
def update_recurring_transaction(
    recurring_transaction_id: UUID,
    recurring_transaction: RecurringTransactionUpdate,
    db: Annotated[Session, Depends(get_session)]
):
    # Get current Recurring Transaction
    db_recurring_transaction = db.get(RecurringTransaction, recurring_transaction_id)
    if not db_recurring_transaction:
        raise HTTPException(status_code=404, detail="This recurring transaction does not exist")

    # Modify the existing Recurring Transaction
    db_recurring_transaction.sqlmodel_update(recurring_transaction.model_dump(exclude_unset=True))

    # Update new transactions based on the updated Recurring Transaction
    update_transactions_from_recurring(recurring_transaction_id, recurring_transaction, db)

    # Commit the changes to the database
    db.commit()

    # Refresh the updated Recurring Transaction
    db.refresh(db_recurring_transaction)

    # Return the updated Recurring Transaction
    return db_recurring_transaction

@router.delete("/recurring/{recurring_transaction_id}")
def delete_recurring_transaction(
    recurring_transaction_id: UUID,
    recurring_transaction: RecurringTransactionDelete,
    db: Annotated[Session, Depends(get_session)]
):
    # Get the Recurring Transaction to delete
    db_recurring_transaction = db.get(RecurringTransaction, recurring_transaction_id)
    if not db_recurring_transaction:
        raise HTTPException(status_code=404, detail="This recurring transaction does not exist")

    # Delete the Recurring Transaction
    db.delete(db_recurring_transaction)

    # Delete transactions associated with this recurring transaction
    delete_transactions_from_recurring(recurring_transaction_id, recurring_transaction, db)

    # Commit the changes to the database
    db.commit()

    # Return a success message
    return {"ok": True}

def create_transactions_from_recurring (
    recurring_transaction: RecurringTransaction,
    db: Session
):
    start_date = recurring_transaction.startDate
    end_date = recurring_transaction.endDate
    frequency = recurring_transaction.frequency
    current_date = start_date

    while current_date <= end_date:
        transaction = Transaction(
            name=recurring_transaction.name,
            category=recurring_transaction.category,
            tags=recurring_transaction.tags,
            amount=recurring_transaction.amount,
            type=recurring_transaction.type,
            date=current_date,
            recurringID=str(recurring_transaction.id)
        )
        db.add(transaction)

        # Increment date based on frequency
        if frequency == "daily":
            current_date += timedelta(days=1)
        elif frequency == "weekly":
            current_date += timedelta(weeks=1)
        elif frequency == "monthly":
            current_date += relativedelta(months=1)
        elif frequency == "yearly":
            current_date += relativedelta(years=1)

def update_transactions_from_recurring (
    recurring_transaction_id: UUID,
    recurring_transaction: RecurringTransactionUpdate,
    db: Session
):
    # Get transactions associated with the recurring transaction
    stmt = select(Transaction).where(Transaction.recurringID == str(recurring_transaction_id))
    if recurring_transaction.applyTo == 'future':
        stmt = stmt.where(Transaction.date > date.today())

    transactions = db.exec(stmt).all()

    # Convert the update object to a dict of only provided fields
    updates = recurring_transaction.model_dump(exclude_unset=True)

    # Get all valid Transaction fields
    transaction_fields = set(Transaction.__fields__.keys())

    # Apply only the provided fields that exist on Transaction
    for transaction in transactions:
        for key, value in updates.items():
            if key in transaction_fields:
                setattr(transaction, key, value)

def delete_transactions_from_recurring (
    recurring_transaction_id: UUID,
    recurring_transaction: RecurringTransactionDelete,
    db: Session
):
    # Get the current date
    today = date.today()

    # Prepare the query to delete transactions associated with the recurring transaction
    stmt = delete(Transaction).where(Transaction.recurringID == str(recurring_transaction_id))
    if recurring_transaction.applyTo == 'future':
        stmt = stmt.where(Transaction.date > today)
    db.exec(stmt)

    # If only deleting future transactions, remove recurringID from past transactions
    if recurring_transaction.applyTo == 'future':
        stmt_update = (
            update(Transaction)
            .where(Transaction.recurringID == str(recurring_transaction_id))
            .where(Transaction.date <= today)
            .values(recurringID="")
        )
        db.exec(stmt_update)
