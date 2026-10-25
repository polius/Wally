"""Settle up, monthly summaries, budgets (2.1) and savings goals (2.2)."""
from typing import Annotated
from datetime import date
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, desc, delete

from ..database import get_session
from ..models.transactions import Transaction
from ..models.money import Settlement, SettlementCreate, Budget, BudgetCreate, Goal, GoalCreate, GoalEntry, GoalEntryCreate
from ..services.ledger import people_ids, parts, ensure_category
from ..util import to_cents, from_cents
from .auth import Actor, check_login

router = APIRouter(tags=["Money"], dependencies=[Depends(check_login)])

# ---------- settle up ----------
def balances(db: Session, until: date | None = None) -> dict[int, int]:
    """What each person is owed (positive) or owes (negative), in cents.

    Every shared expense with a payer: the others owe the payer their share. Payments recorded
    in settle up count against it.
    """
    ids = people_ids(db)
    net = {i: 0 for i in ids}
    stmt = select(Transaction).where(Transaction.person_id.is_(None)).where(Transaction.type == "expense").where(Transaction.paid_by.is_not(None))
    if until:
        stmt = stmt.where(Transaction.date <= until)
    for t in db.exec(stmt).all():
        if t.paid_by not in net:
            continue
        for person, cents in parts(t, ids).items():
            if person != t.paid_by and person in net:
                net[person] -= cents
                net[t.paid_by] += cents
    stmt = select(Settlement)
    if until:
        stmt = stmt.where(Settlement.date <= until)
    for s in db.exec(stmt).all():
        cents = to_cents(s.amount)
        if s.from_person in net:
            net[s.from_person] += cents
        if s.to_person in net:
            net[s.to_person] -= cents
    return net

def transfers(net: dict[int, int]) -> list[dict]:
    """The fewest payments that make everyone even."""
    owed = sorted([[p, c] for p, c in net.items() if c > 0], key=lambda x: -x[1])
    owing = sorted([[p, -c] for p, c in net.items() if c < 0], key=lambda x: -x[1])
    out = []
    i = j = 0
    while i < len(owing) and j < len(owed):
        amount = min(owing[i][1], owed[j][1])
        if amount:
            out.append({"from": owing[i][0], "to": owed[j][0], "amount": str(from_cents(amount))})
        owing[i][1] -= amount
        owed[j][1] -= amount
        if owing[i][1] == 0:
            i += 1
        if owed[j][1] == 0:
            j += 1
    return out

@router.get("/settlements")
def read_settlements(
    db: Annotated[Session, Depends(get_session)],
    until: date | None = None,
):
    net = balances(db, until)
    payments = db.exec(select(Settlement).order_by(desc(Settlement.date), desc(Settlement.id))).all()
    return {
        "net": {str(p): str(from_cents(c)) for p, c in net.items()},
        "transfers": transfers(net),
        "payments": payments,
    }

@router.post("/settlements", response_model=Settlement)
def create_settlement(
    body: SettlementCreate,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    ids = people_ids(db)
    if body.from_person not in ids or body.to_person not in ids:
        raise HTTPException(status_code=400, detail="Both people must be in the household.")
    row = Settlement(**body.model_dump(), created_by=actor.person_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row

@router.delete("/settlements/{settlement_id}")
def delete_settlement(
    settlement_id: int,
    db: Annotated[Session, Depends(get_session)],
):
    row = db.get(Settlement, settlement_id)
    if not row:
        raise HTTPException(status_code=404, detail="This payment does not exist.")
    db.delete(row)
    db.commit()
    return {"ok": True}

# ---------- monthly summary ----------
def _month(value: str) -> date:
    try:
        year, month = value.split("-")[:2]
        return date(int(year), int(month), 1)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Months look like 2026-10.")

@router.get("/summary/monthly")
def monthly_summary(
    db: Annotated[Session, Depends(get_session)],
    start: str | None = Query(default=None, alias="from"),
    end: str | None = Query(default=None, alias="to"),
):
    """Totals per month, by category and by person, in cents. Shared costs count by share."""
    ids = people_ids(db)
    stmt = select(Transaction)
    if start:
        stmt = stmt.where(Transaction.date >= _month(start))
    if end:
        last = _month(end)
        stmt = stmt.where(Transaction.date < date(last.year + last.month // 12, last.month % 12 + 1, 1))
    first = db.exec(select(Transaction.date).order_by(Transaction.date).limit(1)).first()
    months: dict[str, dict] = {}
    for t in db.exec(stmt).all():
        key = t.date.strftime("%Y-%m")
        m = months.setdefault(key, {"month": key, "income": 0, "expense": 0, "recurring": 0, "count": 0, "categories": {}, "people": {}})
        cents = to_cents(t.amount)
        m[t.type] += cents
        m["count"] += 1
        if t.recurringID and t.type == "expense":
            m["recurring"] += cents
        split = parts(t, ids)
        for person, part in split.items():
            p = m["people"].setdefault(str(person), {"income": 0, "expense": 0})
            p[t.type] += part
        if t.type == "expense":
            c = m["categories"].setdefault(t.category, {"total": 0, "people": {}})
            c["total"] += cents
            for person, part in split.items():
                c["people"][str(person)] = c["people"].get(str(person), 0) + part
    return {"first": first.isoformat() if first else None, "months": [months[k] for k in sorted(months)]}

# ---------- budgets (2.1) ----------
@router.get("/budgets", response_model=list[Budget])
def read_budgets(
    db: Annotated[Session, Depends(get_session)],
):
    return db.exec(select(Budget).order_by(Budget.category)).all()

@router.put("/budgets", response_model=list[Budget])
def replace_budgets(
    budgets: list[BudgetCreate],
    db: Annotated[Session, Depends(get_session)],
):
    """Save every budget at once, as the Edit budgets sheet does. Categories left out have none."""
    seen = set()
    for b in budgets:
        if b.category in seen:
            raise HTTPException(status_code=400, detail=f"{b.category} has two budgets.")
        seen.add(b.category)
    db.exec(delete(Budget))
    for b in budgets:
        ensure_category(db, b.category)
        db.add(Budget(**b.model_dump()))
    db.commit()
    return read_budgets(db)

@router.delete("/budgets/{budget_id}")
def delete_budget(
    budget_id: int,
    db: Annotated[Session, Depends(get_session)],
):
    row = db.get(Budget, budget_id)
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}

# ---------- savings goals (2.2) ----------
def _goal_out(db: Session, goal: Goal) -> dict:
    entries = db.exec(select(GoalEntry).where(GoalEntry.goal_id == goal.id).order_by(desc(GoalEntry.date), desc(GoalEntry.id))).all()
    saved = sum((e.amount for e in entries), Decimal("0"))
    return {**goal.model_dump(), "saved": str(saved), "entries": [e.model_dump() for e in entries]}

@router.get("/goals")
def read_goals(
    db: Annotated[Session, Depends(get_session)],
):
    return [_goal_out(db, g) for g in db.exec(select(Goal).order_by(Goal.done, Goal.position, Goal.id)).all()]

@router.post("/goals")
def create_goal(
    body: GoalCreate,
    db: Annotated[Session, Depends(get_session)],
):
    goal = Goal(**body.model_dump())
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return _goal_out(db, goal)

@router.put("/goals/{goal_id}")
def update_goal(
    goal_id: int,
    body: GoalCreate,
    db: Annotated[Session, Depends(get_session)],
    done: bool | None = None,
):
    goal = db.get(Goal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="This goal does not exist.")
    goal.sqlmodel_update(body.model_dump())
    if done is not None:
        goal.done = done
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return _goal_out(db, goal)

@router.delete("/goals/{goal_id}")
def delete_goal(
    goal_id: int,
    db: Annotated[Session, Depends(get_session)],
):
    goal = db.get(Goal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="This goal does not exist.")
    db.exec(delete(GoalEntry).where(GoalEntry.goal_id == goal_id))
    db.delete(goal)
    db.commit()
    return {"ok": True}

@router.post("/goals/{goal_id}/entries")
def add_goal_entry(
    goal_id: int,
    body: GoalEntryCreate,
    db: Annotated[Session, Depends(get_session)],
):
    goal = db.get(Goal, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="This goal does not exist.")
    db.add(GoalEntry(goal_id=goal_id, **body.model_dump()))
    db.commit()
    return _goal_out(db, goal)

@router.delete("/goals/{goal_id}/entries/{entry_id}")
def delete_goal_entry(
    goal_id: int,
    entry_id: int,
    db: Annotated[Session, Depends(get_session)],
):
    entry = db.get(GoalEntry, entry_id)
    if not entry or entry.goal_id != goal_id:
        raise HTTPException(status_code=404, detail="This entry does not exist.")
    db.delete(entry)
    db.commit()
    return _goal_out(db, db.get(Goal, goal_id))
