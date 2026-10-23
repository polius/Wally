from fastapi import APIRouter, Depends, HTTPException, Path
from typing import Annotated
from uuid import UUID
from decimal import Decimal, InvalidOperation
from sqlmodel import Session, select, desc
from datetime import date
from dateutil.relativedelta import relativedelta

from ..database import get_session
from ..models.people import Person
from ..models.transactions import (
    Transaction,
    TransactionCreate,
    TransactionUpdate,
    TransactionPublic,
    TransactionShare,
)
from .auth import check_login

router = APIRouter(tags=["Transactions"], dependencies=[Depends(check_login)])

# One order everywhere: the day it happened, then the moment it was entered.
ORDER = (desc(Transaction.date), desc(Transaction.created_date))


def _known_people(db: Session) -> set[str]:
    return set(db.exec(select(Person.id)).all())


def _prepare_shares(
    db: Session,
    amount: Decimal,
    person_id: str | None,
    shares: list[TransactionShare] | None,
) -> list[dict]:
    """Validate and serialise a shared split.

    A transaction with an owner has no shares. A transaction without an owner
    may carry a split; the parts must add up to the amount.
    """
    if person_id:
        return []
    if not shares:
        return []

    if len(shares) < 2:
        raise HTTPException(status_code=400, detail="A shared transaction needs at least two people.")

    known = _known_people(db)
    total = Decimal("0")
    prepared: list[dict] = []
    seen: set[str] = set()
    for share in shares:
        if share.person_id not in known:
            raise HTTPException(status_code=400, detail="This person does not exist.")
        if share.person_id in seen:
            raise HTTPException(status_code=400, detail="Each person can only appear once in a split.")
        seen.add(share.person_id)
        if share.amount < 0:
            raise HTTPException(status_code=400, detail="A split amount cannot be negative.")
        total += share.amount
        prepared.append({"person_id": share.person_id, "amount": str(share.amount)})

    try:
        difference = abs(Decimal(total) - Decimal(amount))
    except InvalidOperation:
        raise HTTPException(status_code=400, detail="The split could not be read.")
    if difference > Decimal("0.01"):
        raise HTTPException(status_code=400, detail="The split must add up to the transaction amount.")
    return prepared


def _new_transaction(db: Session, payload: TransactionCreate) -> Transaction:
    data = payload.model_dump(exclude={"shares"})
    transaction = Transaction(**data)
    transaction.shares = _prepare_shares(db, payload.amount, payload.person_id, payload.shares)
    return transaction


@router.get("/transactions", response_model=list[TransactionPublic])
def read_transactions(
    db: Annotated[Session, Depends(get_session)],
    person: str | None = None,
):
    statement = select(Transaction).order_by(*ORDER)
    if person == "shared":
        statement = statement.where(Transaction.person_id.is_(None))
    elif person:
        statement = statement.where(Transaction.person_id == person)
    return db.exec(statement).all()


@router.get("/transactions/id/{transaction_id}", response_model=list[TransactionPublic])
def get_transaction_by_id(
    transaction_id: UUID,
    db: Annotated[Session, Depends(get_session)]
):
    transaction = db.get(Transaction, transaction_id)
    return [transaction] if transaction else []


@router.get("/transactions/names/search")
def search_transaction_names(
    db: Annotated[Session, Depends(get_session)],
    q: str
):
    """Search for unique transaction names containing the query string (last year only, max 10 results). Returns name and most recently used category."""
    today = date.today()
    one_year_ago = today - relativedelta(years=1)

    stmt = (
        select(Transaction.name)
        .distinct()
        .where(Transaction.name.ilike(f"%{q}%"))
        .where(Transaction.name != "")
        .where(Transaction.date >= one_year_ago)
        .order_by(Transaction.name)
        .limit(10)
    )
    names = db.exec(stmt).all()

    results = []
    for name in names:
        cat_stmt = (
            select(Transaction.category)
            .where(Transaction.name == name)
            .order_by(*ORDER)
            .limit(1)
        )
        category = db.exec(cat_stmt).first()
        results.append({"name": name, "category": category or ""})

    return results


@router.get("/transactions/date/{year}-{month}", response_model=list[TransactionPublic])
def read_transactions_by_date(
    year: Annotated[int, Path(..., ge=1, le=9999)],
    month: Annotated[int, Path(..., ge=1, le=12)],
    db: Annotated[Session, Depends(get_session)],
    person: str | None = None,
):
    first_day = date(year, month, 1)
    next_month = date(year + (month // 12), (month % 12) + 1, 1)

    stmt = (
        select(Transaction)
        .where(Transaction.date >= first_day)
        .where(Transaction.date < next_month)
        .order_by(*ORDER)
    )
    if person == "shared":
        stmt = stmt.where(Transaction.person_id.is_(None))
    elif person:
        stmt = stmt.where(Transaction.person_id == person)
    return db.exec(stmt).all()


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
        .order_by(*ORDER)
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
        .order_by(*ORDER)
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
        .order_by(*ORDER)
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
        .order_by(*ORDER)
    )
    return db.exec(stmt).all()


@router.get("/transactions/to-date", response_model=list[TransactionPublic])
def get_transactions_to_date(
    db: Annotated[Session, Depends(get_session)]
):
    today = date.today()
    next_month = (today.replace(day=1) + relativedelta(months=1))

    stmt = (
        select(Transaction)
        .where(Transaction.date < next_month)
        .order_by(*ORDER)
    )
    return db.exec(stmt).all()


@router.get("/transactions/range/{from_year}-{from_month}/{to_year}-{to_month}", response_model=list[TransactionPublic])
def get_transactions_by_range(
    from_year: Annotated[int, Path(..., ge=1, le=9999)],
    from_month: Annotated[int, Path(..., ge=1, le=12)],
    to_year: Annotated[int, Path(..., ge=1, le=9999)],
    to_month: Annotated[int, Path(..., ge=1, le=12)],
    db: Annotated[Session, Depends(get_session)],
    person: str | None = None,
):
    first_day = date(from_year, from_month, 1)
    next_month = date(to_year + (to_month // 12), (to_month % 12) + 1, 1)

    stmt = (
        select(Transaction)
        .where(Transaction.date >= first_day)
        .where(Transaction.date < next_month)
        .order_by(*ORDER)
    )
    if person == "shared":
        stmt = stmt.where(Transaction.person_id.is_(None))
    elif person:
        stmt = stmt.where(Transaction.person_id == person)
    return db.exec(stmt).all()


@router.post("/transactions", response_model=TransactionPublic)
def create_transaction(
    transaction: TransactionCreate,
    db: Annotated[Session, Depends(get_session)]
):
    new_transaction = _new_transaction(db, transaction)
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

    data = transaction.model_dump(exclude_unset=True)
    shares = data.pop("shares", None)
    person_id = data.get("person_id", db_transaction.person_id)
    amount = data.get("amount", db_transaction.amount)

    if person_id:
        db_transaction.shares = []
    elif shares is not None:
        db_transaction.shares = _prepare_shares(db, amount, person_id, transaction.shares)
    elif "person_id" in data and data["person_id"] is None and db_transaction.shares:
        # Clearing an owner while keeping a split is valid; clearing both is
        # just an unowned transaction.
        pass

    db_transaction.sqlmodel_update(data)
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
        db.add(_new_transaction(db, transaction))

    db.commit()
    return {"ok": True}
