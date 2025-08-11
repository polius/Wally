import json
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Literal

router = APIRouter(tags=["Settings"])

class Settings(BaseModel):
    categories: list[str] = ['Entertainment', 'Food', 'Groceries', 'Healthcare', 'Income', 'Miscellaneous', 'Rent', 'Shopping', 'Travel', 'Utilities']
    tags: list[str] = []
    currency: Literal["eur", "usd", "gbp", "jpy", "cny", "krw", "inr"] = "eur"

class SettingsUpdate(BaseModel):
    categories: list[str] | None = None
    tags: list[str] | None = None
    currency: Literal["eur", "usd", "gbp", "jpy", "cny", "krw", "inr"] | None = None

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

    # Remove duplicates
    settings_data["categories"] = sorted(set(settings_data["categories"]), key=str.lower)
    settings_data["tags"] = sorted(set(settings_data["tags"]), key=str.lower)

    # Write updated settings back to file
    with open(filename, "w") as f:
        json.dump(settings_data, f)

    # Return the updated settings
    return settings_data
