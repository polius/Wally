from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from .database import create_db_and_tables, engine
from .routers import transactions, recurring_transactions, categories, tags, currency
from .models.categories import Category, DEFAULT_CATEGORIES
from .models.currency import Currency, DEFAULT_CURRENCIES

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create database and tables
    create_db_and_tables()

    # Init database session
    with Session(engine) as db:
        # Create default categories
        if not db.exec(select(Category)).first():
            db.add_all([Category(**data) for data in DEFAULT_CATEGORIES])
            db.commit()

        # Create default currencies
        if not db.exec(select(Currency)).first():
            db.add_all([Currency(**data) for data in DEFAULT_CURRENCIES])
            db.commit()

    yield  # App is running

    # Optional: Clean up database file on shutdown
    db_file = Path("wally.db")
    if db_file.exists():
        db_file.unlink()

# Init FastAPI
app = FastAPI(lifespan=lifespan)

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
app.include_router(categories.router)
app.include_router(tags.router)
app.include_router(currency.router)

# Add root route
@app.get("/", tags=["Test"])
async def root():
    return {"message": "Hello World!"}
