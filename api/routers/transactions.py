import json
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from typing import Annotated
from uuid import UUID, uuid4
from decimal import Decimal
from sqlmodel import Session, select, desc, delete
from datetime import date
from dateutil.relativedelta import relativedelta

from ..database import get_session
from ..models.transactions import Transaction, TransactionCreate, TransactionUpdate, TransactionPublic, TransactionRestore, BulkAction
from ..models.people import Person
from ..models.money import ImportRule
from ..services.ledger import resolve_owner, clean_tags, ensure_category, ensure_tags, people_ids
from ..util import today as household_today, to_cents
from .auth import Actor, check_login, flag

router = APIRouter(tags=["Transactions"], dependencies=[Depends(check_login)])

def _month_bounds(from_year, from_month, to_year, to_month):
    first_day = date(from_year, from_month, 1)
    next_month = date(to_year + (to_month // 12), (to_month % 12) + 1, 1)
    return first_day, next_month

def _between(db: Session, first_day: date, end_exclusive: date):
    stmt = (
        select(Transaction)
        .where(Transaction.date >= first_day)
        .where(Transaction.date < end_exclusive)
        .order_by(desc(Transaction.date), desc(Transaction.created_date))
    )
    return db.exec(stmt).all()

def prepare(db: Session, data: dict, actor: Actor, ids: list[int] | None = None) -> dict:
    """Clean and complete a transaction before saving: tags, category, owner and shares."""
    data["tags"] = clean_tags(data.get("tags"))
    data["category"] = (data.get("category") or "").strip()
    if not data["category"]:
        raise HTTPException(status_code=400, detail="Pick a category.")
    data = resolve_owner(db, data, actor.person_id, ids)
    ensure_category(db, data["category"])
    ensure_tags(db, data["tags"])
    return data

@router.get("/transactions", response_model=list[TransactionPublic])
def read_transactions(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(Transaction).order_by(desc(Transaction.created_date))
    transactions = db.exec(statement).all()
    return transactions

def _json(value):
    return json.loads(value) if isinstance(value, str) else value

LEDGER_COLUMNS = ["id", "date", "name", "category", "cents", "type", "created", "person_id", "created_by", "shares", "paid_by", "tags", "recurring_id", "note", "group_id", "import_ref", "source"]

@router.get("/ledger")
def read_ledger(
    db: Annotated[Session, Depends(get_session)]
):
    """Every transaction, compact, for the web app, which works out every figure in the browser.

    One row per transaction in the order of `columns`, without its trailing empty values;
    amounts in cents, type "e" or "i".
    Read with plain SQL and written straight to JSON: this is the one big read, and it has
    to be quick on a Raspberry Pi with tens of thousands of transactions.
    """
    rows = db.connection().exec_driver_sql(
        'SELECT id, date, name, category, amount, type, person_id, shares, paid_by, tags, "recurringID", note, created_by, group_id, import_ref, source, created_date '
        'FROM "transaction" ORDER BY date DESC, created_date DESC'
    ).fetchall()
    out = []
    for r in rows:
        tags = r[9]
        row = [
            r[0], r[1][:10], r[2], r[3], round(float(r[4]) * 100), "i" if r[5] == "income" else "e", str(r[16])[:19], r[6], r[12],
            _json(r[7]) if r[7] and r[7] != "null" else None, r[8],
            _json(tags) if tags and tags != "[]" else None, r[10] or None, r[11] or None, r[13],
            r[14] or None, _json(r[15]) if r[15] and r[15] != "null" else None,
        ]
        while row[-1] is None:
            row.pop()
        out.append(row)
    body = json.dumps({"columns": LEDGER_COLUMNS, "rows": out}, ensure_ascii=False, separators=(",", ":"))
    return Response(content=body, media_type="application/json")

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
    q: str = "",
    limit: int = 8,
):
    """Payees seen in the last year whose name contains q, most used first.

    Each comes with what it usually is: category, person, tags and amount, so the add sheet
    can fill them in.
    """
    one_year_ago = household_today(db) - relativedelta(years=1)
    stmt = (
        select(Transaction)
        .where(Transaction.name != "")
        .where(Transaction.date >= one_year_ago)
        .order_by(desc(Transaction.date))
    )
    if q:
        stmt = stmt.where(Transaction.name.ilike(f"%{q}%"))
    payees: dict[str, dict] = {}
    for t in db.exec(stmt).all():
        key = t.name.lower()
        p = payees.setdefault(key, {"name": t.name, "type": t.type, "count": 0, "total": Decimal(0), "cats": {}, "people": {}, "tags": {}, "last": t.date, "last_amount": t.amount})
        p["count"] += 1
        p["total"] += t.amount
        p["cats"][t.category] = p["cats"].get(t.category, 0) + 1
        who = "shared" if t.person_id is None else str(t.person_id)
        p["people"][who] = p["people"].get(who, 0) + 1
        for tag in t.tags or []:
            p["tags"][tag] = p["tags"].get(tag, 0) + 1

    def top(counts: dict):
        return max(counts.items(), key=lambda kv: kv[1])[0] if counts else None

    results = []
    for p in payees.values():
        who = top(p["people"])
        starts = p["name"].lower().startswith(q.lower()) if q else False
        results.append({
            "name": p["name"],
            "type": p["type"],
            "category": top(p["cats"]) or "",
            "person_id": None if who in (None, "shared") else int(who),
            "shared": who == "shared",
            "tags": [tag for tag, n in p["tags"].items() if n * 2 >= p["count"]],
            "amount": str((p["total"] / p["count"]).quantize(Decimal("0.01"))),
            "last_amount": str(p["last_amount"]),
            "count": p["count"],
            "last": p["last"].isoformat(),
            "_rank": (not starts, -p["count"]),
        })
    results.sort(key=lambda r: r["_rank"])
    for r in results:
        del r["_rank"]
    return results[:max(1, min(limit, 50))]

@router.get("/transactions/date/{year}-{month}", response_model=list[TransactionPublic])
def read_transactions_by_date(
    year: Annotated[int, Path(..., ge=1, le=9999)],
    month: Annotated[int, Path(..., ge=1, le=12)],
    db: Annotated[Session, Depends(get_session)]
):
    return _between(db, *_month_bounds(year, month, year, month))

@router.get("/transactions/range/{from_year}-{from_month}/{to_year}-{to_month}", response_model=list[TransactionPublic])
def get_transactions_by_range(
    from_year: Annotated[int, Path(..., ge=1, le=9999)],
    from_month: Annotated[int, Path(..., ge=1, le=12)],
    to_year: Annotated[int, Path(..., ge=1, le=9999)],
    to_month: Annotated[int, Path(..., ge=1, le=12)],
    db: Annotated[Session, Depends(get_session)]
):
    return _between(db, *_month_bounds(from_year, from_month, to_year, to_month))

@router.get("/transactions/between", response_model=list[TransactionPublic])
def get_transactions_between(
    db: Annotated[Session, Depends(get_session)],
    start: date = Query(alias="from"),
    end: date = Query(alias="to"),
):
    """Transactions from one day to another, both included."""
    return _between(db, start, end + relativedelta(days=1))

@router.get("/transactions/first")
def first_transaction_date(
    db: Annotated[Session, Depends(get_session)]
):
    first = db.exec(select(Transaction.date).order_by(Transaction.date).limit(1)).first()
    return {"date": first.isoformat() if first else None}

@router.get("/transactions/search", response_model=list[TransactionPublic])
def search_transactions(
    db: Annotated[Session, Depends(get_session)],
    text: Annotated[list[str], Query()] = [],
    tags: Annotated[list[str], Query()] = [],
    categories: Annotated[list[str], Query()] = [],
    person: str | None = None,
    type: str | None = None,
    min: Decimal | None = None,
    max: Decimal | None = None,
    start: date | None = Query(default=None, alias="from"),
    end: date | None = Query(default=None, alias="to"),
    limit: int = 2000,
):
    """Search every month. The web app parses what was typed (#tags, @people, >amounts,
    category names) and sends the parts; every part must match."""
    stmt = select(Transaction).order_by(desc(Transaction.date), desc(Transaction.created_date))
    if start:
        stmt = stmt.where(Transaction.date >= start)
    if end:
        stmt = stmt.where(Transaction.date <= end)
    if min is not None:
        stmt = stmt.where(Transaction.amount >= min)
    if max is not None:
        stmt = stmt.where(Transaction.amount <= max)
    if categories:
        stmt = stmt.where(Transaction.category.in_(categories))
    if type in ("expense", "income"):
        stmt = stmt.where(Transaction.type == type)
    if person == "shared":
        stmt = stmt.where(Transaction.person_id.is_(None))
    elif person and person.isdigit():
        stmt = stmt.where(Transaction.person_id == int(person))

    names = {p.id: p.name.lower() for p in db.exec(select(Person)).all()}
    words = [w.lower() for w in text if w.strip()]
    wanted_tags = [t.lower().lstrip("#") for t in tags if t.strip("# ")]
    out = []
    for t in db.exec(stmt).all():
        tx_tags = [g.lower() for g in (t.tags or [])]
        if any(g not in tx_tags for g in wanted_tags):
            continue
        if words:
            who = names.get(t.person_id, "") if t.person_id is not None else "shared"
            hay = " ".join([t.name, t.note or "", t.category, " ".join("#" + g for g in tx_tags), f"{t.amount:.2f}", who]).lower()
            if any(w not in hay for w in words):
                continue
        out.append(t)
        if len(out) >= limit:
            break
    return out

@router.post("/transactions", response_model=TransactionPublic)
def create_transaction(
    transaction: TransactionCreate,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    data = prepare(db, transaction.model_dump(), actor)
    new_transaction = Transaction(**data, created_by=actor.person_id)
    db.add(new_transaction)
    db.commit()
    db.refresh(new_transaction)
    return new_transaction

@router.post("/transactions/group", response_model=list[TransactionPublic])
def create_split_receipt(
    parts: list[TransactionCreate],
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """One receipt split across categories: one transaction per part, kept together as a group."""
    if len(parts) < 2:
        raise HTTPException(status_code=400, detail="A split receipt has at least two parts.")
    ids = people_ids(db)
    group_id = uuid4().hex
    rows = []
    for part in parts:
        data = prepare(db, part.model_dump(), actor, ids)
        data["group_id"] = group_id
        row = Transaction(**data, created_by=actor.person_id)
        db.add(row)
        rows.append(row)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows

@router.put("/transactions/{transaction_id}", response_model=TransactionPublic)
def update_transaction(
    transaction_id: UUID,
    transaction: TransactionUpdate,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    db_transaction = db.get(Transaction, transaction_id)
    if not db_transaction:
        raise HTTPException(status_code=404, detail="This transaction does not exist")
    changes = transaction.model_dump(exclude_unset=True)
    before = (db_transaction.category, db_transaction.person_id)

    merged = {
        "name": db_transaction.name, "category": db_transaction.category, "tags": db_transaction.tags,
        "amount": db_transaction.amount, "type": db_transaction.type, "date": db_transaction.date,
        "person_id": db_transaction.person_id, "shares": db_transaction.shares, "paid_by": db_transaction.paid_by,
        "note": db_transaction.note, **changes,
    }
    # A new amount or a new owner makes the old shares meaningless unless new ones came with it
    if ("amount" in changes or "person_id" in changes) and "shares" not in changes:
        merged["shares"] = None
    if merged["amount"] is None or Decimal(str(merged["amount"])) <= 0:
        raise HTTPException(status_code=400, detail="Enter an amount.")
    merged = prepare(db, merged, actor)
    db_transaction.sqlmodel_update(merged)

    # Fixing an imported transaction teaches Wally a rule for the next import
    if db_transaction.import_ref and flag(db, "LEARN_RULES") and (db_transaction.category, db_transaction.person_id) != before:
        learn_rule(db, db_transaction)

    db.add(db_transaction)
    db.commit()
    db.refresh(db_transaction)
    return db_transaction

def rule_key(name: str) -> str:
    """The part of a bank's text that stays the same: letters only, without card numbers and dates."""
    words = [w for w in name.upper().replace("*", " ").split() if any(c.isalpha() for c in w) and not any(c.isdigit() for c in w)]
    return " ".join(words[:3])

def learn_rule(db: Session, t: Transaction):
    key = rule_key(t.source.get("name", t.name) if t.source else t.name)
    if not key:
        return
    rule = db.exec(select(ImportRule).where(ImportRule.match == key)).first()
    if rule:
        rule.category = t.category
        rule.person_id = t.person_id
        rule.set_person = True
    else:
        rule = ImportRule(match=key, category=t.category, person_id=t.person_id, learned=True, position=999)
    db.add(rule)

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

@router.post("/transactions/bulk")
def bulk_transactions(
    body: BulkAction,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """Delete several transactions, or change their category or person, at once."""
    rows = [t for t in (db.get(Transaction, i) for i in body.ids) if t]
    if body.action == "delete":
        for t in rows:
            db.delete(t)
        db.commit()
        return {"ok": True, "count": len(rows)}

    ids = people_ids(db)
    for t in rows:
        data = {
            "name": t.name, "category": body.category or t.category, "tags": t.tags, "amount": t.amount,
            "type": t.type, "date": t.date, "person_id": body.person_id if body.set_person else t.person_id,
            "shares": t.shares if not body.set_person else None, "paid_by": t.paid_by, "note": t.note,
        }
        t.sqlmodel_update(prepare(db, data, actor, ids))
        db.add(t)
    db.commit()
    return {"ok": True, "count": len(rows)}

@router.post("/transactions/restore", response_model=list[TransactionPublic])
def restore_transactions(
    transactions: list[TransactionRestore],
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """Undo a delete: put transactions back exactly as they were, with their ids."""
    ids = people_ids(db)
    rows = []
    for t in transactions:
        if db.get(Transaction, t.id):
            continue
        data = t.model_dump()
        if data.get("created_date") is None:
            data.pop("created_date", None)
        owner = prepare(db, {k: data[k] for k in ("name", "category", "tags", "amount", "type", "date", "person_id", "shares", "paid_by", "note")}, actor, ids)
        data.update(owner)
        row = Transaction(**data)
        db.add(row)
        rows.append(row)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows

@router.post("/transactions/import")
def import_transactions(
    transactions: list[TransactionCreate],
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    """Add many transactions as they are. The web app's import uses /import, which also matches."""
    if not transactions:
        raise HTTPException(status_code=400, detail="No transactions to import")
    ids = people_ids(db)
    for transaction in transactions:
        db.add(Transaction(**prepare(db, transaction.model_dump(), actor, ids), created_by=actor.person_id))
    db.commit()
    return {"ok": True, "count": len(transactions)}
