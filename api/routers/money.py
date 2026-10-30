"""Monthly summaries."""
from typing import Annotated
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from ..database import get_session
from ..models.transactions import Transaction
from ..services.ledger import people_ids, parts
from ..util import to_cents
from .auth import check_login

router = APIRouter(tags=["Money"], dependencies=[Depends(check_login)])

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
