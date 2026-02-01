from fastapi import APIRouter, Depends, HTTPException
from typing import Annotated, Literal
from sqlmodel import Session, select

from ..database import get_session
from ..models.currency import Currency, CurrencyPublic, CurrencySettings, CurrencyCreate, CurrencyUpdate
from ..models.app import AppConfig
from .auth import check_login

router = APIRouter(tags=["Currency"], dependencies=[Depends(check_login)])

@router.get("/currency", response_model=CurrencySettings)
def read_currency(
    db: Annotated[Session, Depends(get_session)]
):
    currencies = db.exec(select(Currency).order_by(Currency.name)).all()
    selected = db.get(AppConfig, "SELECTED_CURRENCY").value
    position = db.get(AppConfig, "CURRENCY_POSITION").value
    return {"currencies": currencies, "selected": selected, "position": position}

@router.put("/currency/{currency_name}")
def change_currency(
    currency_name: str,
    db: Annotated[Session, Depends(get_session)]
):
    if not db.get(Currency, currency_name):
        raise HTTPException(status_code=404, detail="This currency does not exist.")
    
    config = db.get(AppConfig, "SELECTED_CURRENCY")
    config.value = currency_name
    db.add(config)
    db.commit()
    return {"message": "Currency updated"}

@router.put("/currency/position/{position}")
def change_currency_position(
    position: Literal["left", "right"],
    db: Annotated[Session, Depends(get_session)]
):
    config = db.get(AppConfig, "CURRENCY_POSITION")
    config.value = position
    db.add(config)
    db.commit()
    return {"message": "Currency position updated"}

@router.post("/currency", response_model=CurrencyPublic)
def create_currency(
    currency: CurrencyCreate,
    db: Annotated[Session, Depends(get_session)]
):
    if db.get(Currency, currency.name):
        raise HTTPException(status_code=400, detail="Currency already exists.")
    
    new_currency = Currency(name=currency.name, symbol=currency.symbol)
    db.add(new_currency)
    db.commit()
    db.refresh(new_currency)
    return new_currency

@router.put("/currency/{old_name}/update", response_model=CurrencyPublic)
def update_currency(
    old_name: str,
    currency: CurrencyUpdate,
    db: Annotated[Session, Depends(get_session)]
):
    db_currency = db.get(Currency, old_name)
    if not db_currency:
        raise HTTPException(status_code=404, detail="Currency not found.")
    
    if old_name != currency.name and db.get(Currency, currency.name):
        raise HTTPException(status_code=400, detail="Currency name already exists.")
    
    # Update selected currency config if needed
    selected = db.get(AppConfig, "SELECTED_CURRENCY")
    if selected.value == old_name:
        selected.value = currency.name
        db.add(selected)
    
    # Delete old and create new (since name is primary key)
    db.delete(db_currency)
    new_currency = Currency(name=currency.name, symbol=currency.symbol)
    db.add(new_currency)
    db.commit()
    db.refresh(new_currency)
    return new_currency

@router.delete("/currency/{currency_name}")
def delete_currency(
    currency_name: str,
    db: Annotated[Session, Depends(get_session)]
):
    db_currency = db.get(Currency, currency_name)
    if not db_currency:
        raise HTTPException(status_code=404, detail="Currency not found.")
    
    # Prevent deleting the selected currency
    selected = db.get(AppConfig, "SELECTED_CURRENCY")
    if selected.value == currency_name:
        raise HTTPException(status_code=400, detail="Cannot delete the currently selected currency. Please select a different currency before deleting this one.")
    
    db.delete(db_currency)
    db.commit()
    return {"message": "Currency deleted"}
