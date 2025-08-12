from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError

from ..database import get_session
from ..models.categories import Category, CategoryCreate, CategoryPublic

router = APIRouter(tags=["Categories"])

@router.get("/categories/", response_model=list[str])
def read_categories(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(Category).order_by(Category.name)
    categories = db.exec(statement).all()
    return sorted([c.name for c in categories], key=str.lower)

@router.post("/categories/", response_model=CategoryPublic)
def create_category(
    category: CategoryCreate,
    db: Annotated[Session, Depends(get_session)]
):
    new_category = Category.model_validate(category)
    db.add(new_category)
    try:
        db.commit()
        db.refresh(new_category)
        return new_category
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="This category already exists.")

@router.delete("/categories/{category_name}")
def delete_category(
    category_name: str,
    db: Annotated[Session, Depends(get_session)]
):
    category = db.get(Category, category_name)
    if not category:
        raise HTTPException(status_code=404, detail="This category does not exist.")
    db.delete(category)
    db.commit()
    return {"ok": True}
