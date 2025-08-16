from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated
from sqlmodel import Session, select, update

from ..database import get_session
from ..models.currency import Currency, CurrencyPublic
from .auth import check_login

router = APIRouter(tags=["Currency"], dependencies=[Depends(check_login)])

@router.get("/currency/", response_model=list[CurrencyPublic])
def read_currency(
    db: Annotated[Session, Depends(get_session)]
):
    statement = select(Currency).order_by(Currency.name)
    currency = db.exec(statement).all()
    return currency

@router.put("/currency/{currency_name}", response_model=list[CurrencyPublic])
def change_currency(
    currency_name: str,
    db: Annotated[Session, Depends(get_session)]
):
    db_currency = db.get(Currency, currency_name)
    if not db_currency:
        raise HTTPException(status_code=404, detail="This currency does not exist.")
    
    # Set all currencies selected=False
    db.exec(update(Currency).values(selected=False))

    # Set the current currency selected=True
    db_currency.selected = True

    # Commit changes
    db.commit()

    # Return all currencies (updated)
    currencies = db.exec(select(Currency)).all()
    return currencies
