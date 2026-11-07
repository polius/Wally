"""Who owns what: people, shares of shared costs, categories and tags kept in step with transactions."""
from fastapi import HTTPException
from sqlmodel import Session, select

from ..models.people import Person
from ..models.categories import Category
from ..models.tags import Tag
from ..util import to_cents, even_shares

def people_ids(db: Session) -> list[int]:
    return [p.id for p in db.exec(select(Person).order_by(Person.position, Person.id)).all()]

def clean_tags(tags: list[str] | None) -> list[str]:
    """Tags are stored without the #, once each, in the order given."""
    out = []
    for tag in tags or []:
        name = tag.strip().lstrip("#").strip()
        if name and name not in out:
            out.append(name[:40])
    return out

def ensure_category(db: Session, name: str):
    if name and not db.get(Category, name):
        db.add(Category(name=name))

def ensure_tags(db: Session, tags: list[str]):
    for tag in tags:
        if not db.get(Tag, tag):
            db.add(Tag(name=tag))

def resolve_owner(db: Session, data: dict, actor_person: int | None, ids: list[int] | None = None) -> dict:
    """Validate person, shares and paid_by on a transaction or rule, filling in what is implied.

    - person_id set: it is theirs, so no shares and no payer.
    - person_id None with two or more people: shared. Shares are in cents and add up to the
      amount; without shares it splits evenly, the spare cent going to whoever paid.
    - With fewer than two people there is nothing to split.
    """
    ids = people_ids(db) if ids is None else ids
    person_id = data.get("person_id")
    if person_id is not None:
        if person_id not in ids:
            raise HTTPException(status_code=400, detail="This person does not exist.")
        data["shares"] = None
        data["paid_by"] = None
        return data

    if len(ids) < 2:
        data["shares"] = None
        data["paid_by"] = None
        return data

    cents = to_cents(data["amount"])
    payer = data.get("paid_by")
    if data.get("type", "expense") == "income":
        payer = None
    elif payer is None:
        payer = actor_person if actor_person in ids else ids[0]
    elif payer not in ids:
        raise HTTPException(status_code=400, detail="Paid by must be someone in the household.")
    data["paid_by"] = payer

    shares = data.get("shares")
    if shares:
        clean = {}
        for key, value in shares.items():
            if not str(key).isdigit() or int(key) not in ids:
                raise HTTPException(status_code=400, detail="Shares can only be for people in the household.")
            if not isinstance(value, int) or value < 0:
                raise HTTPException(status_code=400, detail="Shares are whole cents, zero or more.")
            if value:
                clean[str(int(key))] = value
        if sum(clean.values()) != cents:
            raise HTTPException(status_code=400, detail="Shares must add up to the amount.")
        data["shares"] = clean
    else:
        data["shares"] = even_shares(cents, ids, payer)
    return data

def parts(tx, ids: list[int]) -> dict[int, int]:
    """Each person's part of a transaction in cents. Shared ones without stored shares split evenly."""
    cents = to_cents(tx.amount)
    if tx.person_id is not None:
        return {tx.person_id: cents}
    if tx.shares:
        return {int(k): v for k, v in tx.shares.items()}
    if not ids:
        return {}
    return {int(k): v for k, v in even_shares(cents, ids, tx.paid_by).items()}
