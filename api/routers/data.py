"""Import with matching, import rules, backups and household settings."""
import hashlib
import json
import re
import shutil
import tempfile
from difflib import SequenceMatcher
from pathlib import Path
from typing import Annotated, Literal
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID
from pydantic import BaseModel, model_validator
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session, select, func

from ..database import get_session
from ..models.app import AppConfig, PUBLIC_KEYS
from ..models.money import ImportRule, ImportRuleCreate
from ..models.people import Person
from ..models.transactions import Transaction
from ..services import backups as backup_service
from ..services.ledger import people_ids, clean_tags
from .auth import Actor, check_login, config, set_config
from .transactions import prepare

router = APIRouter(tags=["Data"], dependencies=[Depends(check_login)])

# ---------- import ----------
class ImportRow(BaseModel):
    date: date
    name: str = ""
    amount: Decimal
    type: Literal["expense", "income"] = "expense"
    category: str = ""
    tags: list[str] = []
    # A person's name, "shared", or empty to leave it to the rules
    person: str = ""
    paid_by: str = ""
    note: str = ""

    @model_validator(mode="after")
    def check_row(self):
        if self.amount < 0:
            self.amount = -self.amount
        if self.amount == 0:
            raise ValueError("amount cannot be zero")
        return self

class CommitRow(ImportRow):
    import_ref: str
    action: Literal["add", "match", "skip"]
    match_id: UUID | None = None
    person_id: int | None = None
    shared: bool = False

class CommitBody(BaseModel):
    rows: list[CommitRow]

def _words(name: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", name.lower()) if len(w) >= 3}

def similar(a: str, b: str) -> bool:
    """Names that are the same payee, as a bank and a person write it: "MERCADONA 4521 BCN" and "Mercadona"."""
    if not a or not b:
        return False
    na, nb = " ".join(sorted(_words(a))), " ".join(sorted(_words(b)))
    if _words(a) & _words(b):
        return True
    return SequenceMatcher(None, na, nb).ratio() >= 0.75

def import_refs(rows: list[ImportRow]) -> list[str]:
    """A fingerprint per bank row. Identical rows in one file (two coffees on a day) stay apart."""
    seen: dict[str, int] = {}
    out = []
    for r in rows:
        base = f"{r.date.isoformat()}|{r.type}|{r.amount:.2f}|{r.name.strip().lower()}"
        n = seen.get(base, 0)
        seen[base] = n + 1
        out.append(hashlib.sha256(f"{base}|{n}".encode()).hexdigest()[:32])
    return out

def apply_rules(rules: list[ImportRule], name: str) -> ImportRule | None:
    upper = name.upper()
    for rule in rules:
        if rule.match.upper() in upper:
            return rule
    return None

def past_choices(db: Session, rows: list[ImportRow]) -> dict[tuple[str, str], Transaction]:
    """The latest transaction for each name and type in the file, as the add sheet remembers payees."""
    names = {r.name.strip().lower() for r in rows if r.name.strip()}
    if not names:
        return {}
    past = db.exec(select(Transaction).where(func.lower(func.trim(Transaction.name)).in_(names)).order_by(Transaction.date, Transaction.created_date)).all()
    return {(t.name.strip().lower(), t.type): t for t in past}

def _person_from(raw: str, people: dict[str, int]) -> tuple[int | None, bool]:
    """(person_id, shared) from a name in a file."""
    value = raw.strip().lower()
    if not value:
        return None, False
    if value in ("shared", "compartido", "compartit", "household"):
        return None, True
    return people.get(value), False

@router.post("/import/preview")
def import_preview(
    rows: list[ImportRow],
    db: Annotated[Session, Depends(get_session)],
):
    """What an import would do, before anything is saved: new, matched, possible or skipped."""
    if not rows:
        raise HTTPException(status_code=400, detail="This file has no rows.")
    refs = import_refs(rows)
    people = {p.name.lower(): p.id for p in db.exec(select(Person)).all()}
    rules = db.exec(select(ImportRule).order_by(ImportRule.position, ImportRule.id)).all()
    known = set(db.exec(select(Transaction.import_ref).where(Transaction.import_ref.in_(refs))).all())
    past = past_choices(db, rows)

    lo, hi = min(r.date for r in rows) - timedelta(days=3), max(r.date for r in rows) + timedelta(days=3)
    typed = db.exec(select(Transaction).where(Transaction.import_ref.is_(None)).where(Transaction.date >= lo).where(Transaction.date <= hi)).all()
    imported = db.exec(select(Transaction).where(Transaction.import_ref.is_not(None)).where(Transaction.date >= lo).where(Transaction.date <= hi)).all()
    taken: set[UUID] = set()

    out = []
    counts = {"new": 0, "matched": 0, "possible": 0, "skipped": 0}
    for i, (row, ref) in enumerate(zip(rows, refs)):
        item = {"index": i, "import_ref": ref, "status": "new", "match": None, "rule_id": None}
        person_id, shared = _person_from(row.person, people)
        category = row.category
        if ref in known:
            item["status"] = "skipped"
        elif any(t.import_ref and t.type == row.type and t.amount == row.amount and t.date == row.date and t.name.strip().lower() == row.name.strip().lower() for t in imported):
            # Already in Wally from another file, such as Wally's own export of a matched row
            item["status"] = "skipped"
        else:
            same = [t for t in typed if t.id not in taken and t.type == row.type and t.amount == row.amount and abs((t.date - row.date).days) <= 3]
            match = next((t for t in same if similar(t.name, row.name)), None)
            possible = None if match else next((t for t in same if t.date == row.date), None)
            if match or possible:
                hit = match or possible
                taken.add(hit.id)
                item["status"] = "matched" if match else "possible"
                item["match"] = {"id": str(hit.id), "name": hit.name, "date": hit.date.isoformat(), "category": hit.category, "person_id": hit.person_id}
            else:
                rule = apply_rules(rules, row.name)
                if rule:
                    item["rule_id"] = rule.id
                    if not category:
                        category = rule.category
                    if not row.person and rule.set_person:
                        person_id, shared = rule.person_id, rule.person_id is None
                elif (last := past.get((row.name.strip().lower(), row.type))):
                    # No rule: the same name was added before, so it gets what it got then
                    if not category:
                        category = last.category
                    if not row.person:
                        person_id, shared = last.person_id, last.person_id is None
        item.update({"category": category, "person_id": person_id, "shared": shared})
        counts[item["status"]] += 1
        out.append(item)
    return {"rows": out, "counts": counts}

@router.post("/import/commit")
def import_commit(
    body: CommitBody,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    ids = people_ids(db)
    rules = db.exec(select(ImportRule).order_by(ImportRule.position, ImportRule.id)).all()
    added = matched = 0
    for row in body.rows:
        if row.action == "skip":
            continue
        if db.exec(select(Transaction.id).where(Transaction.import_ref == row.import_ref)).first():
            continue
        if row.action == "match":
            hit = db.get(Transaction, row.match_id) if row.match_id else None
            if not hit:
                raise HTTPException(status_code=400, detail="A matched transaction no longer exists. Preview the file again.")
            hit.import_ref = row.import_ref
            hit.source = {"name": row.name, "date": row.date.isoformat()}
            db.add(hit)
            matched += 1
            continue
        data = {
            "name": row.name, "category": row.category or "Miscellaneous", "tags": clean_tags(row.tags),
            "amount": row.amount, "type": row.type, "date": row.date, "note": row.note,
            "person_id": None if row.shared else row.person_id, "shares": None,
            "paid_by": int(row.paid_by) if row.paid_by.isdigit() else None,
        }
        if data["person_id"] is None and not row.shared and len(ids) >= 2 and actor.person_id in ids:
            # Not said in the file and no rule: it was whoever imports it
            data["person_id"] = actor.person_id
        data = prepare(db, data, actor, ids)
        db.add(Transaction(**data, import_ref=row.import_ref, created_by=actor.person_id))
        rule = apply_rules(rules, row.name)
        if rule:
            rule.uses += 1
            db.add(rule)
        added += 1
    db.commit()
    return {"added": added, "matched": matched}

# ---------- import rules (2.1) ----------
@router.get("/rules", response_model=list[ImportRule])
def read_rules(
    db: Annotated[Session, Depends(get_session)],
):
    return db.exec(select(ImportRule).order_by(ImportRule.position, ImportRule.id)).all()

@router.post("/rules", response_model=ImportRule)
def create_rule(
    body: ImportRuleCreate,
    db: Annotated[Session, Depends(get_session)],
):
    position = (db.exec(select(func.max(ImportRule.position))).first() or 0) + 1
    rule = ImportRule(**{**body.model_dump(), "match": body.match.strip().upper()}, position=position)
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule

@router.put("/rules/order", response_model=list[ImportRule])
def reorder_rules(
    ids: list[int],
    db: Annotated[Session, Depends(get_session)],
):
    for position, rule_id in enumerate(ids):
        rule = db.get(ImportRule, rule_id)
        if rule:
            rule.position = position
            db.add(rule)
    db.commit()
    return read_rules(db)

@router.put("/rules/{rule_id}", response_model=ImportRule)
def update_rule(
    rule_id: int,
    body: ImportRuleCreate,
    db: Annotated[Session, Depends(get_session)],
):
    rule = db.get(ImportRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="This rule does not exist.")
    rule.sqlmodel_update({**body.model_dump(), "match": body.match.strip().upper()})
    rule.learned = False
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule

@router.delete("/rules/{rule_id}")
def delete_rule(
    rule_id: int,
    db: Annotated[Session, Depends(get_session)],
):
    rule = db.get(ImportRule, rule_id)
    if rule:
        db.delete(rule)
        db.commit()
    return {"ok": True}

# ---------- backups (2.1) ----------
@router.get("/backups")
def read_backups():
    return backup_service.list_backups()

@router.post("/backups")
def create_backup(
    db: Annotated[Session, Depends(get_session)],
):
    return backup_service.create_backup("manual", db)

@router.get("/backups/{name}")
def download_backup(name: str):
    path = backup_service.backup_path(name)
    return FileResponse(path, media_type="application/vnd.sqlite3", filename=f"wally-{name}")

@router.delete("/backups/{name}")
def delete_backup(name: str):
    backup_service.backup_path(name).unlink()
    return {"ok": True}

@router.post("/backups/{name}/restore")
def restore_backup(name: str):
    return backup_service.restore(backup_service.backup_path(name))

@router.post("/backups/upload")
def restore_upload(file: UploadFile):
    """Restore from a backup file kept somewhere else."""
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "upload.db"
        with path.open("wb") as out:
            shutil.copyfileobj(file.file, out)
        return backup_service.restore(path)

# ---------- settings ----------
def _value(key: str, raw: str):
    if key == "SAVED_VIEWS":
        try:
            return json.loads(raw or "[]")
        except ValueError:
            return []
    if key in ("NIGHTLY_BACKUP", "LEARN_RULES", "ONBOARDED"):
        return raw in ("1", "true", "True")
    if key == "SAVINGS_TARGET":
        return float(raw or 0)
    return raw

@router.get("/config")
def read_config(
    db: Annotated[Session, Depends(get_session)],
):
    rows = {r.key: r.value for r in db.exec(select(AppConfig).where(AppConfig.key.in_(PUBLIC_KEYS))).all()}
    return {key.lower(): _value(key, rows.get(key, "")) for key in sorted(PUBLIC_KEYS)}

@router.put("/config")
def update_config(
    changes: dict,
    db: Annotated[Session, Depends(get_session)],
):
    for raw_key, value in changes.items():
        key = raw_key.upper()
        if key not in PUBLIC_KEYS:
            raise HTTPException(status_code=400, detail=f"{raw_key} is not a setting.")
        if key == "SAVINGS_TARGET":
            try:
                value = float(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="The savings target is a share of income, from 0 to 90.")
            if not 0 <= value <= 90:
                raise HTTPException(status_code=400, detail="The savings target is a share of income, from 0 to 90.")
            value = f"{value:g}"
        elif key == "WEEK_START" and value not in ("mon", "sun", "sat"):
            raise HTTPException(status_code=400, detail="Weeks start on mon, sun or sat.")
        elif key == "OPEN_ON" and value not in ("dashboard", "transactions", "recurring", "budgets"):
            raise HTTPException(status_code=400, detail="Not a page Wally can open on.")
        elif key == "TIMEZONE" and value:
            from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
            try:
                ZoneInfo(value)
            except (ZoneInfoNotFoundError, ValueError):
                raise HTTPException(status_code=400, detail="Not a time zone.")
        elif key == "SAVED_VIEWS":
            if not isinstance(value, list) or not all(isinstance(v, dict) and str(v.get("name", "")).strip() and isinstance(v.get("query", ""), str) for v in value):
                raise HTTPException(status_code=400, detail="Saved views need a name and a search.")
            value = json.dumps([{"name": str(v["name"]).strip()[:40], "query": v["query"][:200]} for v in value])
        set_config(db, key, value)
    db.commit()
    return read_config(db)
