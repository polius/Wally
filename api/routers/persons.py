from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError

from ..database import get_session
from ..models.persons import Person, PersonCreate, PersonPublic, PersonUpdate
from ..models.transactions import Transaction
from .auth import check_login

router = APIRouter(tags=["Persons"], dependencies=[Depends(check_login)])

@router.get("/persons", response_model=list[str])
def read_persons(
    db: Annotated[Session, Depends(get_session)]
):
    persons = db.exec(select(Person).order_by(Person.name)).all()
    return sorted([p.name for p in persons], key=str.lower)

@router.post("/persons", response_model=PersonPublic)
def create_person(
    person: PersonCreate,
    db: Annotated[Session, Depends(get_session)]
):
    new_person = Person.model_validate(person)
    db.add(new_person)
    try:
        db.commit()
        db.refresh(new_person)
        return new_person
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="This person already exists.")

@router.put("/persons/{person_name}", response_model=PersonPublic)
def update_person(
    person_name: str,
    person_update: PersonUpdate,
    db: Annotated[Session, Depends(get_session)]
):
    person = db.get(Person, person_name)
    if not person:
        raise HTTPException(status_code=404, detail="This person does not exist.")

    new_name = person_update.name

    # Cascade update all transactions using this person
    statement = select(Transaction).where(Transaction.person == person_name)
    for transaction in db.exec(statement).all():
        transaction.person = new_name
        db.add(transaction)

    person_data = person_update.model_dump(exclude_unset=True)
    person.sqlmodel_update(person_data)

    try:
        db.add(person)
        db.commit()
        db.refresh(person)
        return person
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="A person with this name already exists.")

@router.delete("/persons/{person_name}")
def delete_person(
    person_name: str,
    db: Annotated[Session, Depends(get_session)]
):
    person = db.get(Person, person_name)
    if not person:
        raise HTTPException(status_code=404, detail="This person does not exist.")

    # Clear person from all transactions using this person
    statement = select(Transaction).where(Transaction.person == person_name)
    for transaction in db.exec(statement).all():
        transaction.person = ""
        db.add(transaction)

    db.delete(person)
    db.commit()
    return {"ok": True}
