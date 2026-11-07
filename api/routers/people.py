from typing import Annotated
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, delete, func

from ..database import get_session, STATE
from ..models.people import Person, PersonCreate, PersonUpdate, PersonPublic, SessionToken, person_public, next_color
from ..models.transactions import Transaction
from ..models.recurring_transactions import RecurringTransaction
from ..models.api_keys import ApiKeys
from ..services.ledger import people_ids
from ..util import to_cents, even_shares
from .auth import Actor, check_login, flag

router = APIRouter(tags=["People"], dependencies=[Depends(check_login)])

class RemovePerson(BaseModel):
    # Their own transactions move to this person, or become shared when None
    move_to: int | None = None
    # With encryption on, the browser moves their transactions itself and sends the sealed
    # changes here, saved together with the removal
    ops: list[dict] | None = None

class FromTag(BaseModel):
    tag: str
    remove_tag: bool = True

class FromTags(BaseModel):
    # Tag to person, all at once, as after the upgrade from 1.x
    tags: dict[str, int]
    remove_tag: bool = True
    # Everything still shared without any of the tags becomes this person's: the household's only
    # person after the upgrade, or whoever the untagged expenses were for
    rest: int | None = None

@router.get("/people", response_model=list[PersonPublic])
def read_people(
    db: Annotated[Session, Depends(get_session)],
):
    return [person_public(p) for p in db.exec(select(Person).order_by(Person.position, Person.id)).all()]

@router.post("/people", response_model=PersonPublic)
def create_person(
    body: PersonCreate,
    db: Annotated[Session, Depends(get_session)],
):
    name = body.name.strip()
    if db.exec(select(Person).where(func.lower(Person.name) == name.lower())).first():
        raise HTTPException(status_code=400, detail="Someone with this name is already here.")
    position = (db.exec(select(func.max(Person.position))).first() or 0) + 1
    # They sign in with the household password, like everyone else
    person = Person(name=name, position=position, color=next_color(db.exec(select(Person.color)).all()))
    db.add(person)
    db.commit()
    db.refresh(person)
    return person_public(person)

@router.put("/people/order", response_model=list[PersonPublic])
def reorder_people(
    ids: list[int],
    db: Annotated[Session, Depends(get_session)],
):
    for position, person_id in enumerate(ids):
        person = db.get(Person, person_id)
        if person:
            person.position = position
            db.add(person)
    db.commit()
    return read_people(db)

@router.put("/people/{person_id}", response_model=PersonPublic)
def update_person(
    person_id: int,
    body: PersonUpdate,
    db: Annotated[Session, Depends(get_session)],
):
    person = db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="This person does not exist.")
    if body.name is not None:
        name = body.name.strip()
        clash = db.exec(select(Person).where(func.lower(Person.name) == name.lower()).where(Person.id != person_id)).first()
        if clash:
            raise HTTPException(status_code=400, detail="Someone with this name is already here.")
        person.name = name
    if body.position is not None:
        person.position = body.position
    if body.color is not None:
        person.color = body.color
    db.add(person)
    db.commit()
    db.refresh(person)
    return person_public(person)

@router.get("/people/{person_id}/usage")
def person_usage(
    person_id: int,
    db: Annotated[Session, Depends(get_session)],
):
    """What removing this person would touch, for the confirmation."""
    own = db.exec(select(func.count()).select_from(Transaction).where(Transaction.person_id == person_id)).one()
    shared = sum(1 for t in db.exec(select(Transaction).where(Transaction.person_id.is_(None))).all() if t.shares and str(person_id) in t.shares or t.paid_by == person_id)
    rules = db.exec(select(func.count()).select_from(RecurringTransaction).where(RecurringTransaction.person_id == person_id)).one()
    return {"own": own, "shared": shared, "rules": rules}

def _respread(item, removed: int, ids_left: list[int], move_to: int | None):
    """Give a removed person's part of a shared transaction or rule to someone still here."""
    if item.person_id == removed:
        item.person_id = move_to
        item.shares = None
        item.paid_by = None
    if item.person_id is not None:
        return
    if len(ids_left) < 2:
        item.shares = None
        item.paid_by = None
        return
    if item.paid_by == removed:
        item.paid_by = move_to if move_to in ids_left else ids_left[0]
    if item.shares and str(removed) in item.shares:
        cents = to_cents(item.amount)
        shares = {k: v for k, v in item.shares.items() if k != str(removed) and int(k) in ids_left}
        if not shares:
            item.shares = even_shares(cents, ids_left, item.paid_by)
        else:
            heir = str(move_to) if move_to in ids_left else str(item.paid_by or ids_left[0])
            shares[heir] = shares.get(heir, 0) + item.shares[str(removed)]
            item.shares = shares

@router.delete("/people/{person_id}")
def delete_person(
    person_id: int,
    body: RemovePerson,
    db: Annotated[Session, Depends(get_session)],
    actor: Actor = Depends(check_login),
):
    person = db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="This person does not exist.")
    ids_left = [i for i in people_ids(db) if i != person_id]
    if flag(db, "LOGIN_PAGE") and not ids_left:
        raise HTTPException(status_code=400, detail="Turn sign-in off before removing the last person.")
    if body.move_to is not None and body.move_to not in ids_left:
        raise HTTPException(status_code=400, detail="Move their transactions to someone still here.")

    if STATE.get("vault"):
        if actor.via == "key":
            # Their transactions move in the browser, which can open them
            raise HTTPException(status_code=409, detail="While Wally is encrypted, remove people in Settings › People.")
        from ..services import vault as records
        with records.WRITE_LOCK:
            result = {"seq": 0, "versions": {}, "skipped": []}
            if body.ops:
                try:
                    result = records.apply_batch(db, body.ops)
                except records.Conflict as error:
                    db.rollback()
                    raise HTTPException(status_code=409, detail=records.conflict_response(error))
            _remove_person(db, person)
            db.commit()
        return {"ok": True, **result}

    for item in list(db.exec(select(Transaction).where((Transaction.person_id == person_id) | (Transaction.person_id.is_(None)))).all()) + \
                list(db.exec(select(RecurringTransaction)).all()):
        before = (item.person_id, item.shares, item.paid_by)
        _respread(item, person_id, ids_left, body.move_to)
        if (item.person_id, item.shares, item.paid_by) != before:
            db.add(item)

    _remove_person(db, person)
    db.commit()
    return {"ok": True}

def _remove_person(db: Session, person: Person):
    """Their sign-ins and API keys go with them. They still know the household password:
    Settings says to change it if they shouldn't come back."""
    person_id = person.id
    db.exec(delete(SessionToken).where(SessionToken.person_id == person_id))
    db.exec(delete(ApiKeys).where(ApiKeys.person_id == person_id))
    db.delete(person)

@router.get("/people/from-tag/preview")
def from_tag_preview(
    tag: str,
    db: Annotated[Session, Depends(get_session)],
):
    tag = tag.lstrip("#")
    count = sum(1 for t in db.exec(select(Transaction.tags)).all() if t and tag in t)
    return {"tag": tag, "count": count}

def convert_tags(db: Session, tags: dict[str, int], remove_tag: bool, rest: int | None = None) -> dict:
    """Turn tags into people: what has one of the tags becomes that person's, recurring rules
    included, so their next charges are theirs too. What has tags of two or more of them stays
    shared. With rest, what has none of the tags and is shared evenly, as everything from 1.x is,
    becomes that person's; a split someone chose stays as it is. The caller commits, or rolls back
    for a preview."""
    tags = {tag.lstrip("#"): person_id for tag, person_id in tags.items()}
    for person_id in set(tags.values()) | ({rest} if rest is not None else set()):
        if not db.get(Person, person_id):
            raise HTTPException(status_code=404, detail="This person does not exist.")
    counts = {person_id: 0 for person_id in tags.values()}
    # A few of each person's, newest first, so it's plain what the tag meant
    examples = {person_id: [] for person_id in tags.values()}
    shared = rested = 0
    newest = select(Transaction).order_by(Transaction.date.desc(), Transaction.created_date.desc())
    for row in [*db.exec(newest).all(), *db.exec(select(RecurringTransaction)).all()]:
        found = [tag for tag in (row.tags or []) if tag in tags]
        if not found:
            if rest is not None and row.person_id is None and not row.shares and row.paid_by is None:
                row.person_id = rest
                if isinstance(row, Transaction):
                    rested += 1
                db.add(row)
            continue
        owners = {tags[tag] for tag in found}
        if len(owners) == 1:
            row.person_id = owners.pop()
            row.shares = None
            row.paid_by = None
            if isinstance(row, Transaction):
                counts[row.person_id] += 1
                seen = examples[row.person_id]
                if row.name and row.name not in seen and len(seen) < 3:
                    seen.append(row.name)
        elif isinstance(row, Transaction):
            shared += 1
        if remove_tag:
            row.tags = [g for g in row.tags if g not in found]
        db.add(row)
    return {"counts": counts, "shared": shared, "examples": examples, "rest": rested}

@router.post("/people/{person_id}/from-tag")
def from_tag(
    person_id: int,
    body: FromTag,
    db: Annotated[Session, Depends(get_session)],
):
    """Turn a tag into a person: every transaction with the tag becomes theirs."""
    result = convert_tags(db, {body.tag: person_id}, body.remove_tag)
    db.commit()
    return {"ok": True, "count": result["counts"][person_id]}

@router.post("/people/from-tags/preview")
def from_tags_preview(
    body: FromTags,
    db: Annotated[Session, Depends(get_session)],
):
    result = convert_tags(db, body.tags, body.remove_tag, body.rest)
    db.rollback()
    return result

@router.post("/people/from-tags")
def from_tags(
    body: FromTags,
    db: Annotated[Session, Depends(get_session)],
):
    result = convert_tags(db, body.tags, body.remove_tag, body.rest)
    db.commit()
    return {"ok": True, **result}
