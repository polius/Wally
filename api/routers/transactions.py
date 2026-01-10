from fastapi import APIRouter, Depends, HTTPException, Path
from typing import Annotated
from uuid import UUID
from sqlmodel import Session, select, desc
from datetime import date
from dateutil.relativedelta import relativedelta

from ..database import get_session
from ..models.transactions import Transaction, TransactionCreate, TransactionUpdate, TransactionPublic
from .auth import check_login

router = APIRouter(tags=["Transactions"], dependencies=[Depends(check_login)])

@router.get("/transactions", response_model=list[TransactionPublic])
def read_transactions(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(Transaction).order_by(desc(Transaction.created_date))
    transactions = db.exec(statement).all()
    return transactions

@router.get("/transactions/id/{transaction_id}", response_model=list[TransactionPublic])
def get_transaction_by_id(
    transaction_id: UUID,
    db: Annotated[Session, Depends(get_session)]
):
    transaction = db.get(Transaction, transaction_id)
    return [transaction] if transaction else []

@router.get("/transactions/date/{year}-{month}", response_model=list[TransactionPublic])
def read_transactions_by_date(
    year: Annotated[int, Path(..., ge=1, le=9999)],
    month: Annotated[int, Path(..., ge=1, le=12)],
    db: Annotated[Session, Depends(get_session)]
):
    first_day = date(year, month, 1)
    next_month = date(year + (month // 12), (month % 12) + 1, 1)

    stmt = (
        select(Transaction)
        .where(Transaction.date >= first_day)
        .where(Transaction.date < next_month)
        .order_by(desc(Transaction.created_date))
    )
    results = db.exec(stmt).all()
    return results

@router.get("/transactions/past-3-months", response_model=list[TransactionPublic])
def get_transactions_past_3_months(
    db: Annotated[Session, Depends(get_session)]
):
    today = date.today()
    first_day = (today.replace(day=1) - relativedelta(months=2))
    next_month = (today.replace(day=1) + relativedelta(months=1))

    stmt = (
        select(Transaction)
        .where(Transaction.date >= first_day)
        .where(Transaction.date < next_month)
        .order_by(desc(Transaction.date))
    )
    return db.exec(stmt).all()

@router.get("/transactions/past-6-months", response_model=list[TransactionPublic])
def get_transactions_past_6_months(
    db: Annotated[Session, Depends(get_session)]
):
    today = date.today()
    first_day = (today.replace(day=1) - relativedelta(months=5))
    next_month = (today.replace(day=1) + relativedelta(months=1))

    stmt = (
        select(Transaction)
        .where(Transaction.date >= first_day)
        .where(Transaction.date < next_month)
        .order_by(desc(Transaction.date))
    )
    return db.exec(stmt).all()

@router.get("/transactions/past-12-months", response_model=list[TransactionPublic])
def get_transactions_past_12_months(
    db: Annotated[Session, Depends(get_session)]
):
    today = date.today()
    first_day = (today.replace(day=1) - relativedelta(months=11))
    next_month = (today.replace(day=1) + relativedelta(months=1))

    stmt = (
        select(Transaction)
        .where(Transaction.date >= first_day)
        .where(Transaction.date < next_month)
        .order_by(desc(Transaction.date))
    )
    return db.exec(stmt).all()

@router.get("/transactions/year-to-date", response_model=list[TransactionPublic])
def get_transactions_ytd(
    db: Annotated[Session, Depends(get_session)]
):
    today = date.today()
    first_day = date(today.year, 1, 1)
    next_month = (today.replace(day=1) + relativedelta(months=1))

    stmt = (
        select(Transaction)
        .where(Transaction.date >= first_day)
        .where(Transaction.date < next_month)
        .order_by(desc(Transaction.created_date))
    )
    results = db.exec(stmt).all()
    return results

@router.get("/transactions/to-date", response_model=list[TransactionPublic])
def get_transactions_to_date(
    db: Annotated[Session, Depends(get_session)]
):
    today = date.today()
    next_month = (today.replace(day=1) + relativedelta(months=1))

    stmt = (
        select(Transaction)
        .where(Transaction.date < next_month)
        .order_by(desc(Transaction.created_date))
    )
    results = db.exec(stmt).all()
    return results

@router.get("/transactions/range/{from_year}-{from_month}/{to_year}-{to_month}", response_model=list[TransactionPublic])
def get_transactions_by_range(
    from_year: Annotated[int, Path(..., ge=1, le=9999)],
    from_month: Annotated[int, Path(..., ge=1, le=12)],
    to_year: Annotated[int, Path(..., ge=1, le=9999)],
    to_month: Annotated[int, Path(..., ge=1, le=12)],
    db: Annotated[Session, Depends(get_session)]
):
    first_day = date(from_year, from_month, 1)
    next_month = date(to_year + (to_month // 12), (to_month % 12) + 1, 1)

    stmt = (
        select(Transaction)
        .where(Transaction.date >= first_day)
        .where(Transaction.date < next_month)
        .order_by(desc(Transaction.created_date))
    )
    results = db.exec(stmt).all()
    return results

@router.post("/transactions", response_model=TransactionPublic)
def create_transaction(
    transaction: TransactionCreate,
    db: Annotated[Session, Depends(get_session)]
):
    new_transaction = Transaction.model_validate(transaction)
    db.add(new_transaction)
    db.commit()
    db.refresh(new_transaction)
    return new_transaction

@router.put("/transactions/{transaction_id}", response_model=TransactionPublic)
def update_transaction(
    transaction_id: UUID,
    transaction: TransactionUpdate,
    db: Annotated[Session, Depends(get_session)]
):
    db_transaction = db.get(Transaction, transaction_id)
    if not db_transaction:
        raise HTTPException(status_code=404, detail="This transaction does not exist")
    db_transaction.sqlmodel_update(transaction.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(db_transaction)
    return db_transaction

@router.delete("/transactions/{transaction_id}")
def delete_transaction(
    transaction_id: UUID,
    db: Annotated[Session, Depends(get_session)]
):
    transaction = db.get(Transaction, transaction_id)
    if not transaction:
        raise HTTPException(status_code=404, detail="This transaction does not exist")
    db.delete(transaction)
    db.commit()
    return {"ok": True}

@router.post("/transactions/import")
def import_transactions(
    transactions: list[TransactionCreate],
    db: Annotated[Session, Depends(get_session)]
):
    if not transactions:
        raise HTTPException(status_code=400, detail="No transactions to import")

    for transaction in transactions:
        new_transaction = Transaction.model_validate(transaction)
        db.add(new_transaction)

    db.commit()
    return {"ok": True}
