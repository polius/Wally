from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select

from ..database import get_session
from ..models.users import User, UserCreate, UserUpdate, UserPublic

router = APIRouter(tags=["Users"])

@router.get("/users/", response_model=list[UserPublic])
def read_users(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(User).order_by(User.created_date)
    users = db.exec(statement).all()
    return users

@router.post("/users/", response_model=UserPublic)
def create_user(
    user: UserCreate,
    db: Annotated[Session, Depends(get_session)]
):
    new_user = User.model_validate(user)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@router.put("/users/{username}", response_model=UserPublic)
def update_user(
    username: str,
    user: UserUpdate,
    db: Annotated[Session, Depends(get_session)]
):
    db_user = db.get(User, username)
    if not db_user:
        raise HTTPException(status_code=404, detail="This user does not exist")
    user = user.model_dump(exclude_unset=True)
    db_user.sqlmodel_update(user)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.delete("/users/{username}")
def delete_user(
    username: str,
    db: Annotated[Session, Depends(get_session)]
):
    user = db.get(User, username)
    if not user:
        raise HTTPException(status_code=404, detail="This user does not exist")
    db.delete(user)
    db.commit()
    return {"ok": True}
