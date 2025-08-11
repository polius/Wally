import os
import json

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import create_db_and_tables
from .routers import transactions, recurring_transactions, settings

# Create database and tables
create_db_and_tables()

# Create default config file if it does not exist
filename = "config.json"
default_content = {
    "categories": ['Entertainment', 'Food', 'Groceries', 'Healthcare', 'Income', 'Miscellaneous', 'Rent', 'Shopping', 'Travel', 'Utilities'],
    "tags": [],
    "currency": "eur"
}
if not os.path.isfile(filename):
    with open(filename, "w") as f:
        json.dump(default_content, f)

# Init FastAPI
app = FastAPI()

# Allow your dev frontend origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://192.168.1.79:5500",
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

