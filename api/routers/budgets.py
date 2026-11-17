"""Limits (see models/budget.py). js/vault/local.js answers the same paths for an encrypted household."""
import re
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from ..database import get_session
from ..models.budget import Budget
from ..models.categories import Category
from ..util import to_cents, from_cents
from .auth import check_login

router = APIRouter(tags=["Budget"], dependencies=[Depends(check_login)])
MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
AMOUNT = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)$")

def parse_amount(value) -> Decimal:
    """An amount as people type it ("120,5" too), in cents rounded half up as everywhere in Wally.
    js/vault/local.js reads it the same way."""
    s = str(value if value is not None else "").strip().replace(",", ".")
    if not AMOUNT.match(s):
        raise HTTPException(status_code=400, detail="Enter an amount.")
    cents = to_cents(Decimal(s))
    if cents <= 0 or cents >= 10_000_000_000:
        raise HTTPException(status_code=400, detail="Enter an amount above zero.")
    return from_cents(cents)

def public(b: Budget) -> dict:
    return {"id": b.id, "category": b.category, "period": b.period, "amount": f"{b.amount:.2f}", "since": b.since, "until": b.until}

def month_before(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7]) - 1
    return f"{y - 1}-12" if mo == 0 else f"{y}-{mo:02d}"

def _check(category: str, month: str, db: Session, exists: bool = True):
    if not MONTH.match(month or ""):
        raise HTTPException(status_code=400, detail="The month must be YYYY-MM.")
    # Removing needs no category: a limit left on one deleted meanwhile on another device can still go
    if exists and category and not db.get(Category, category):
        raise HTTPException(status_code=404, detail="This category does not exist.")

def _end_from(db: Session, category: str, month: str) -> Budget | None:
    """Clear the way from month on: rows starting later go, and the one running then ends the month
    before. Returns the row that starts exactly in month, if there is one."""
    starting = None
    for b in db.exec(select(Budget).where(Budget.category == category).order_by(Budget.id)).all():
        if b.since > month:
            db.delete(b)
        elif b.since == month:
            # Two devices that set a first limit at once leave two rows for one month: one stays
            if starting is None:
                starting = b
            else:
                db.delete(b)
        elif b.until is None or b.until >= month:
            b.until = month_before(month)
            db.add(b)
    return starting

@router.get("/budgets")
def read_budgets(db: Annotated[Session, Depends(get_session)]):
    """Every limit, past ones included, oldest first"""
    return [public(b) for b in db.exec(select(Budget).order_by(Budget.category, Budget.since)).all()]

class LimitIn(BaseModel):
    category: str = ""
    period: Literal["month", "year"] = "month"
    amount: str | int | float
    month: str

@router.put("/budgets")
def set_limit(body: LimitIn, db: Annotated[Session, Depends(get_session)]):
    """A limit from this month on: the month's row is changed, or the running one ends and a new one starts"""
    _check(body.category, body.month, db)
    if body.category == "" and body.period != "month":
        # The limit for everything is the month's: what is left today, per day and in the toast all count a month
        raise HTTPException(status_code=400, detail="The limit for everything is for each month.")
    amount = parse_amount(body.amount)
    row = _end_from(db, body.category, body.month)
    if row is None:
        row = Budget(category=body.category, since=body.month)
    row.period, row.amount, row.until = body.period, amount, None
    db.add(row)
    db.commit()
    db.refresh(row)
    return public(row)

@router.delete("/budgets")
def remove_limit(month: str, db: Annotated[Session, Depends(get_session)], category: str = ""):
    """No limit from this month on. Earlier months keep theirs."""
    _check(category, month, db, exists=False)
    row = _end_from(db, category, month)
    if row is not None:
        db.delete(row)
    db.commit()
    return {"ok": True}

def rename_category(db: Session, old: str, new: str):
    """Renaming a category keeps its limits. The caller commits."""
    for b in db.exec(select(Budget).where(Budget.category == old)).all():
        b.category = new
        db.add(b)

def drop_category(db: Session, name: str):
    """Deleting a category, or merging it into another, removes its limits (the other keeps its own). The caller commits."""
    for b in db.exec(select(Budget).where(Budget.category == name)).all():
        db.delete(b)
