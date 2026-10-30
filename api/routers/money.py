"""Settle up and monthly summaries."""
from typing import Annotated
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, desc

from ..database import get_session
from ..models.transactions import Transaction
from ..models.money import Settlement, SettlementCreate
from ..services.ledger import people_ids, parts
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
