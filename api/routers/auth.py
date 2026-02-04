import os
import jwt
import bcrypt
import random
import string
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Annotated
from pydantic import BaseModel
from fastapi import Depends, APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database import get_session
from ..models.app import AppConfig

class Login(BaseModel):
    password: str

class LoginPassword(BaseModel):
    password: str | None

ACCESS_EXPIRE_MINUTES = 5
REFRESH_EXPIRE_DAYS = 365
HTTPS = os.getenv("HTTPS", "false").lower() == "true"

# Initialize FastAPI router
router = APIRouter(tags=["Auth"])

@router.post("/login")
def login(
    login: Login, 
    db: Annotated[Session, Depends(get_session)]
) -> JSONResponse:
    
    # Retrieve login settings
    login_page = int(db.get(AppConfig, "LOGIN_PAGE").value)
    login_password = db.get(AppConfig, "LOGIN_PASSWORD").value

    # Check if login page is enabled
    if not login_page:
        return JSONResponse("Login page is disabled", status_code=200)

    # Check database password
    database_match = bcrypt.checkpw(login.password.encode('utf-8'), login_password.encode('utf-8'))

    # Check recovery password if it exists
    recover_password_file = Path("password.txt").resolve()
    recover_match = False

    if recover_password_file.exists():
        recover_password_value = recover_password_file.read_text(encoding="utf-8").strip()
        recover_password_hash = bcrypt.hashpw(recover_password_value.encode('utf-8'), bcrypt.gensalt())
        recover_match = bcrypt.checkpw(login.password.encode('utf-8'), recover_password_hash)
        if recover_match:
            # Remove recovery file after successful use
            recover_password_file.unlink(missing_ok=True)

    # Raise error if neither password matches
    if not database_match and not recover_match:
        raise HTTPException(status_code=401, detail="Incorrect password")

    # Delete "password.txt" if the recover password was used
    if recover_match:
        recover_password_file.unlink(missing_ok=True)

    # Generate an access token and refresh_token
    secret_key = db.get(AppConfig, "SECRET_KEY").value
    access_token = jwt.encode({"sub": "admin", "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_EXPIRE_MINUTES)}, secret_key, algorithm='HS512')
    refresh_token = jwt.encode({"sub": "admin", "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS)}, secret_key, algorithm='HS512')

    # Store the updated refresh token in DB
    db.get(AppConfig, "LOGIN_TOKEN").value = refresh_token
    db.commit()

    # Create a JSON response with the access token
    response = JSONResponse(f"Welcome back!", status_code=200)

    # Set the access token as a secure HTTP-only cookie (can't be accessed via JavaScript)
    response.set_cookie(key="access_token", value=access_token, expires=datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS), httponly=True, samesite='strict', secure=HTTPS)

    # Return the response with access token and refresh token in the cookie
    return response

@router.post("/logout")
def logout(response: Response):
    # Clear the access_token cookie
    response.delete_cookie(key="access_token")
    return {"message": "Logged out successfully"}

def check_login (
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_session)],
):
    # Check if login is enabled
    if int(db.get(AppConfig, "LOGIN_PAGE").value):
        secret_key = db.get(AppConfig, "SECRET_KEY").value
        login_token = db.get(AppConfig, "LOGIN_TOKEN").value
        access_token = request.cookies.get("access_token")

        if not access_token:
            raise HTTPException(status_code=401, detail="No access token")

        try:
            jwt.decode(access_token, secret_key, algorithms=['HS512'])
        except jwt.ExpiredSignatureError:
            # Check validify of the refresh token (stored in the database)
            try:
                jwt.decode(login_token, secret_key, algorithms=['HS512'])
            except jwt.ExpiredSignatureError:
                raise HTTPException(status_code=401, detail="Refresh token has expired.")
            else:
                # Issue new access token
                new_access_token = jwt.encode({"sub": "admin", "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_EXPIRE_MINUTES)}, secret_key, algorithm='HS512')
                response.set_cookie(key="access_token", value=new_access_token, expires=datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS), httponly=True, samesite='strict', secure=HTTPS)

        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid access token.")


@router.get("/login/check", response_model=bool)
def get_login_page_enabled(
    db: Annotated[Session, Depends(get_session)],
    _ = Depends(check_login),
):
    return db.get(AppConfig, "LOGIN_PAGE").value

@router.get("/language")
def get_language(
    db: Annotated[Session, Depends(get_session)],
):
    language_config = db.get(AppConfig, "LANGUAGE")
    return {"language": language_config.value}

@router.put("/language/{language}")
def update_language(
    language: str,
    db: Annotated[Session, Depends(get_session)],
    _ = Depends(check_login),
):
    config = db.get(AppConfig, "LANGUAGE")
    config.value = language
    db.add(config)
    db.commit()
    return {"message": "Language updated"}

@router.post("/login/password")
def set_login_password(
    login: LoginPassword,
    db: Annotated[Session, Depends(get_session)],
    _ = Depends(check_login),
):
    if not login.password:
        db.get(AppConfig, "LOGIN_PAGE").value = False
    else:
        db.get(AppConfig, "LOGIN_PAGE").value = True
        password_hash = bcrypt.hashpw(login.password.encode('utf-8'), bcrypt.gensalt()).decode()
        db.get(AppConfig, "LOGIN_PASSWORD").value = password_hash

    db.commit()
    return "Password changed"

@router.post("/login/recover")
def recover_password():
    # Characters: letters (upper+lower) + digits
    chars = string.ascii_letters + string.digits  

    # Generate 12-character password
    password = ''.join(random.choices(chars, k=12))

    # Save to a file
    file_path = Path("password.txt").resolve()
    file_path.write_text(password, encoding="utf-8")

    return {"message": "Recovery password generated.", "file": str(file_path)}
