from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError

from ..database import get_session
from ..models.tags import Tag, TagCreate, TagPublic

router = APIRouter(tags=["Tags"])

@router.get("/tags/", response_model=list[str])
def read_tags(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(Tag).order_by(Tag.name)
    tags = db.exec(statement).all()
    return sorted([t.name for t in tags], key=str.lower)

@router.post("/tags/", response_model=TagPublic)
def create_tag(
    tag: TagCreate,
    db: Annotated[Session, Depends(get_session)]
):
    new_tag = Tag.model_validate(tag)
    db.add(new_tag)
    try:
        db.commit()
        db.refresh(new_tag)
        return new_tag
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="This tag already exists.")

@router.delete("/tags/{tag_name}")
def delete_tag(
    tag_name: str,
    db: Annotated[Session, Depends(get_session)]
):
    tag = db.get(Tag, tag_name)
    if not tag:
        raise HTTPException(status_code=404, detail="This tag does not exist.")
    db.delete(tag)
    db.commit()
    return {"ok": True}
