import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError

from ..database import get_session
from ..models.users import User, UserCreate, UserUpdate, UserPublic

router = APIRouter(tags=["Users"])

@router.get("/users/", response_model=list[UserPublic])
def read_users(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(User).order_by(User.username)
    users = db.exec(statement).all()
    return users

@router.post("/users/", response_model=UserPublic)
def create_user(
    user: UserCreate,
    db: Annotated[Session, Depends(get_session)]
):
    new_user = User.model_validate(user)
    db.add(new_user)
    try:
        db.commit()
        db.refresh(new_user)
        return new_user
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="This username already exists.")

@router.put("/users/{username}", response_model=UserPublic)
def update_user(
    username: str,
    user: UserUpdate,
    db: Annotated[Session, Depends(get_session)]
):
    db_user = db.get(User, username)
    if not db_user:
        raise HTTPException(status_code=404, detail="This user does not exist.")

    update_data = user.model_dump(exclude_unset=True)

    # Prevent updating the last admin user to non-admin
    if db_user.admin and not user.admin and len(list(db.exec(select(User).where(User.admin == True)))) == 1:
        raise HTTPException(status_code=400, detail="Cannot remove admin status from the last admin user.")

    # Handle username change separately
    new_username = update_data.get("username")
    if new_username and new_username != username:
        # Ensure the new username is not already taken
        if db.get(User, new_username):
            raise HTTPException(status_code=400, detail="New username already exists.")
        db_user.username = new_username
    
    # If password is provided, hash it
    if "password" in update_data and update_data["password"]:
        db_user.password = bcrypt.hashpw(update_data["password"].encode('utf-8'), bcrypt.gensalt()).decode()

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
    
    # Prevent deletion of the last admin user
    if user.admin and len(list(db.exec(select(User).where(User.admin == True)))) == 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin user.")

    db.delete(user)
    db.commit()
    return {"ok": True}
