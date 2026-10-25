from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from uuid import UUID
from datetime import date, timedelta
from pydantic import BaseModel
from sqlmodel import Session, select, desc
from sqlalchemy import update, delete

from ..database import get_session
from ..models.transactions import Transaction
from ..models.recurring_transactions import RecurringTransaction, RecurringTransactionCreate, RecurringTransactionUpdate, RecurringTransactionDelete, RecurringTransactionPublic
from ..services.engine import run_rule, next_date, dates_between, make_transaction
from ..services.ledger import resolve_owner, clean_tags, ensure_category, ensure_tags
from ..util import today as household_today
from .auth import Actor, check_login

router = APIRouter(tags=["Recurring Transactions"], dependencies=[Depends(check_login)])

SCHEDULE = ("startDate", "frequency", "interval")
FIELDS = ("name", "category", "tags", "amount", "type", "person_id", "shares", "paid_by")

class EndRule(BaseModel):
    date: date

class Missed(BaseModel):
    add: bool

def _get(db: Session, rule_id: UUID) -> RecurringTransaction:
    rule = db.get(RecurringTransaction, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="This recurring transaction does not exist")
    return rule

def _prepare(db: Session, data: dict, actor: Actor) -> dict:
    data["tags"] = clean_tags(data.get("tags"))
    data = resolve_owner(db, data, actor.person_id)
    ensure_category(db, data["category"])
    ensure_tags(db, data["tags"])
    return data

@router.get("/recurring", response_model=list[RecurringTransactionPublic])
def read_recurring_transactions(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(RecurringTransaction).order_by(desc(RecurringTransaction.created_date))
    return db.exec(statement).all()

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
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    data = _prepare(db, recurring_transaction.model_dump(), actor)
    rule = RecurringTransaction(**data)
    db.add(rule)
    # Dates up to today become transactions now; later ones on their day
    run_rule(db, rule, household_today(db))
    db.commit()
    db.refresh(rule)
    return rule

@router.put("/recurring/{recurring_transaction_id}", response_model=RecurringTransactionPublic)
def update_recurring_transaction(
    recurring_transaction_id: UUID,
    recurring_transaction: RecurringTransactionUpdate,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """Change a rule.

    - "later" (from the next charge): the transactions it made stay as they are. If it already
      made some, the old rule ends the day before the next charge and a new one starts there.
    - "all": the rule changes in place and its past transactions are rewritten to match.
    """
    rule = _get(db, recurring_transaction_id)
    changes = recurring_transaction.model_dump(exclude_unset=True)
    apply_to = changes.pop("applyTo", "later")
    if apply_to == "future":
        apply_to = "later"

    merged = {k: getattr(rule, k) for k in RecurringTransactionCreate.model_fields}
    merged.update(changes)
    if ("amount" in changes or "person_id" in changes) and "shares" not in changes:
        merged["shares"] = None
    merged = _prepare(db, RecurringTransactionCreate.model_validate(merged).model_dump(), actor)
    today = household_today(db)
    rule_id = str(rule.id)
    made = db.exec(select(Transaction.id).where(Transaction.recurringID == rule_id).limit(1)).first()

    if apply_to == "later" and made:
        if "startDate" in changes:
            start = changes["startDate"]
            if start <= today:
                raise HTTPException(status_code=400, detail="A change from the next charge starts after today. To change past charges too, choose All.")
        else:
            start = next_date(rule, today)
            if start is None:
                raise HTTPException(status_code=400, detail="This rule has no more charges to change.")
            merged["startDate"] = start
        new_rule = RecurringTransaction(**merged)
        if "startDate" not in changes and merged["frequency"] == rule.frequency and rule.frequency in ("monthly", "yearly"):
            # Keep falling on the same day, even if the next charge is on a shorter month's last day
            new_rule.anchor_day = rule.anchor_day or rule.startDate.day
        new_rule.last_run = today
        rule.endDate = start - timedelta(days=1)
        db.add(rule)
        db.add(new_rule)
        db.commit()
        db.refresh(new_rule)
        return new_rule

    schedule_changed = any(merged[k] != getattr(rule, k) for k in SCHEDULE)
    end_changed = merged["endDate"] != rule.endDate
    rule.sqlmodel_update(merged)
    if "startDate" in changes or "frequency" in changes:
        rule.anchor_day = None
    db.add(rule)

    if made and apply_to == "all":
        if schedule_changed:
            # Different dates: make its past again from the new schedule
            db.exec(delete(Transaction).where(Transaction.recurringID == rule_id))
            rule.last_run = None
        else:
            values = {k: merged[k] for k in FIELDS}
            db.exec(update(Transaction).where(Transaction.recurringID == rule_id).values(**values))
            if end_changed and rule.endDate is not None:
                db.exec(delete(Transaction).where(Transaction.recurringID == rule_id).where(Transaction.date > rule.endDate))
    elif not made:
        rule.last_run = None

    run_rule(db, rule, today)
    db.commit()
    db.refresh(rule)
    return rule

@router.post("/recurring/{recurring_transaction_id}/end", response_model=RecurringTransactionPublic)
def end_recurring_transaction(
    recurring_transaction_id: UUID,
    body: EndRule,
    db: Annotated[Session, Depends(get_session)],
):
    """End a rule on a date. What it already made stays."""
    rule = _get(db, recurring_transaction_id)
    if body.date < rule.startDate:
        raise HTTPException(status_code=400, detail="A rule cannot end before it starts.")
    rule.endDate = body.date
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule

@router.post("/recurring/{recurring_transaction_id}/pause", response_model=RecurringTransactionPublic)
def pause_recurring_transaction(
    recurring_transaction_id: UUID,
    db: Annotated[Session, Depends(get_session)],
):
    rule = _get(db, recurring_transaction_id)
    if not rule.paused:
        run_rule(db, rule, household_today(db))
        rule.paused = True
        db.add(rule)
        db.commit()
        db.refresh(rule)
    return rule

@router.post("/recurring/{recurring_transaction_id}/resume", response_model=RecurringTransactionPublic)
def resume_recurring_transaction(
    recurring_transaction_id: UUID,
    db: Annotated[Session, Depends(get_session)],
):
    """Resume a paused rule. Dates missed while paused are not added; they are offered once."""
    rule = _get(db, recurring_transaction_id)
    if rule.paused:
        today = household_today(db)
        missed = dates_between(rule, rule.last_run, today)
        rule.missed = [d.isoformat() for d in missed] or None
        rule.paused = False
        rule.last_run = today
        db.add(rule)
        db.commit()
        db.refresh(rule)
    return rule

@router.post("/recurring/{recurring_transaction_id}/missed", response_model=RecurringTransactionPublic)
def handle_missed(
    recurring_transaction_id: UUID,
    body: Missed,
    db: Annotated[Session, Depends(get_session)],
):
    """Add the dates missed while paused, or dismiss them."""
    rule = _get(db, recurring_transaction_id)
    if body.add:
        rule_id = str(rule.id)
        for raw in rule.missed or []:
            on = date.fromisoformat(raw)
            if not db.exec(select(Transaction.id).where(Transaction.recurringID == rule_id).where(Transaction.date == on)).first():
                db.add(make_transaction(rule, on))
    rule.missed = None
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule

@router.delete("/recurring/{recurring_transaction_id}")
def delete_recurring_transaction(
    recurring_transaction_id: UUID,
    recurring_transaction: RecurringTransactionDelete,
    db: Annotated[Session, Depends(get_session)]
):
    rule = _get(db, recurring_transaction_id)
    rule_id = str(rule.id)
    db.delete(rule)
    if recurring_transaction.applyTo == "all":
        db.exec(delete(Transaction).where(Transaction.recurringID == rule_id))
    else:
        # Past transactions stay, as ordinary ones
        db.exec(update(Transaction).where(Transaction.recurringID == rule_id).values(recurringID=""))
    db.commit()
    return {"ok": True}
