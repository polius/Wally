import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Literal

router = APIRouter(tags=["Settings"])

class Settings(BaseModel):
    categories: list[str] = ["Food","Groceries","Travel","Rent","Utilities","Entertainment","Healthcare","Shopping","Miscellaneous","Income"]
    currency: Literal["eur", "usd", "gbp", "jpy", "cny", "krw", "inr"] = "eur"

class SettingsUpdate(BaseModel):
    categories: list[str] | None = None
    currency: Literal["eur", "usd"] | None = None

filename = "config.json"

@router.get("/settings/", response_model=Settings)
def read_settings():
    with open(filename) as f:
        data = json.load(f)
    return data

@router.put("/settings/", response_model=Settings)
def modify_settings(
    settings: SettingsUpdate
):
    # Read current settings
    with open(filename) as f:
        settings_data = json.load(f)

    # Update only the provided fields
    settings = settings.model_dump(exclude_unset=True)
    settings_data.update(settings)

    # Write updated settings back to file
    with open(filename, "w") as f:
        json.dump(settings_data, f)

    # Return the updated settings
    return settings_data
