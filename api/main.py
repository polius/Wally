import os
import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import create_db_and_tables
from .routers import transactions, recurring_transactions, settings

# Init FastAPI
app = FastAPI()

# Allow your dev frontend origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://192.168.100.22:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add routes
app.include_router(transactions.router)
app.include_router(recurring_transactions.router)
app.include_router(settings.router)

# Add root route
@app.get("/", tags=["Test"])
async def root():
    return {"message": "Hello World!"}

# Initialize sqlite schema if does not exist
@app.on_event("startup")
def on_startup():
    # Create database and tables
    create_db_and_tables()

    # Create default config file if it does not exist
    filename = "config.json"
    default_content = {
        "categories": [
            "Food",
            "Groceries",
            "Travel",
            "Rent",
            "Utilities",
            "Entertainment",
            "Healthcare",
            "Shopping",
            "Miscellaneous",
            "Income"
        ],
        "currency": "eur"
    }

    if not os.path.isfile(filename):
        with open(filename, "w") as f:
            json.dump(default_content, f)
