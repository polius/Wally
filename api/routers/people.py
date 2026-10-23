from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select

from ..database import get_session
from ..models.people import (
    Person,
    PersonCreate,
    PersonUpdate,
    PersonPublic,
    PersonFromTag,
)
from ..models.transactions import Transaction
from ..models.recurring_transactions import RecurringTransaction
from .auth import check_login

router = APIRouter(tags=["People"], dependencies=[Depends(check_login)])


@router.get("/people", response_model=list[PersonPublic])
def read_people(
    db: Annotated[Session, Depends(get_session)]
):
    return db.exec(select(Person).order_by(Person.created_date)).all()


@router.post("/people", response_model=PersonPublic)
def create_person(
    person: PersonCreate,
    db: Annotated[Session, Depends(get_session)]
):
    name = person.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="A person needs a name.")
    if len(name) > 60:
        raise HTTPException(status_code=400, detail="This name is too long.")
    existing = db.exec(select(Person).where(Person.name.ilike(name))).first()
    if existing:
        raise HTTPException(status_code=400, detail="A person with this name already exists.")

    new_person = Person(name=name)
    db.add(new_person)
    db.commit()
    db.refresh(new_person)
    return new_person


@router.put("/people/{person_id}", response_model=PersonPublic)
def update_person(
    person_id: str,
    person: PersonUpdate,
    db: Annotated[Session, Depends(get_session)]
):
    db_person = db.get(Person, person_id)
    if not db_person:
        raise HTTPException(status_code=404, detail="This person does not exist.")

    if person.name is not None:
        name = person.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="A person needs a name.")
        if len(name) > 60:
            raise HTTPException(status_code=400, detail="This name is too long.")
        clash = db.exec(
            select(Person).where(Person.name.ilike(name)).where(Person.id != person_id)
        ).first()
        if clash:
            raise HTTPException(status_code=400, detail="A person with this name already exists.")
        db_person.name = name

    if person.is_self is not None:
        if person.is_self:
            for other in db.exec(select(Person)).all():
                other.is_self = False
                db.add(other)
        db_person.is_self = person.is_self

    db.add(db_person)
    db.commit()
    db.refresh(db_person)
    return db_person


@router.delete("/people/{person_id}")
def delete_person(
    person_id: str,
    db: Annotated[Session, Depends(get_session)]
):
    db_person = db.get(Person, person_id)
    if not db_person:
        raise HTTPException(status_code=404, detail="This person does not exist.")

    # Keep every transaction. An owned row becomes unowned; a shared row keeps
    # its split minus the removed person, and becomes unowned if one part is left.
    for transaction in db.exec(select(Transaction)).all():
        changed = False
        if transaction.person_id == person_id:
            transaction.person_id = None
            changed = True
        if transaction.shares:
            remaining = [s for s in transaction.shares if s.get("person_id") != person_id]
            if len(remaining) != len(transaction.shares):
                transaction.shares = remaining if len(remaining) >= 2 else []
                changed = True
        if changed:
            db.add(transaction)

    for rule in db.exec(select(RecurringTransaction).where(RecurringTransaction.person_id == person_id)).all():
        rule.person_id = None
        db.add(rule)

    db.delete(db_person)
    db.commit()
    return {"ok": True}


@router.post("/people/from-tag", response_model=PersonPublic)
def person_from_tag(
    payload: PersonFromTag,
    db: Annotated[Session, Depends(get_session)]
):
    """Turn an existing tag into a person, once, and remove it from the rows.

    This is the migration the interface offers when a tag follows nearly every
    transaction. It is deliberately one tag at a time and reversible by
    re-adding the tag by hand.
    """
    tag = payload.tag.strip()
    name = payload.name.strip()
    if not tag or not name:
        raise HTTPException(status_code=400, detail="A tag and a name are required.")

    existing = db.exec(select(Person).where(Person.name.ilike(name))).first()
    if existing:
        person = existing
    else:
        person = Person(name=name)
        db.add(person)
        db.commit()
        db.refresh(person)

    matched = 0
    for transaction in db.exec(select(Transaction)).all():
        if tag in (transaction.tags or []):
            transaction.person_id = person.id
            transaction.tags = [t for t in transaction.tags if t != tag]
            db.add(transaction)
            matched += 1

    if not matched:
        raise HTTPException(status_code=404, detail="No transactions carry this tag.")

    db.commit()
    db.refresh(person)
    return person
