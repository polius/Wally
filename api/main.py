from pathlib import Path
from contextlib import asynccontextmanager
import secrets

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from .database import create_db_and_tables, engine
from .routers import transactions, recurring_transactions, categories, tags, currency, auth
from .models.app import AppConfig
from .models.categories import Category, DEFAULT_CATEGORIES
from .models.currency import Currency, DEFAULT_CURRENCIES

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create database and tables
    create_db_and_tables()

    # Init database session
    with Session(engine) as db:
        # Create default settings
        if not db.get(AppConfig, "SECRET_KEY"):
            db.add(AppConfig(key="SECRET_KEY", value=secrets.token_hex(32)))
            db.add(AppConfig(key="LOGIN_PAGE", value=False))
            db.add(AppConfig(key="LOGIN_PASSWORD", value=''))
            db.add(AppConfig(key="LOGIN_TOKEN", value=''))
            db.add(AppConfig(key="IS_DEMO", value=False))
            db.commit()

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
    # db_file = Path("wally.db")
    # if db_file.exists():
    #     db_file.unlink()

# Init FastAPI
app = FastAPI(title='Wally API', version='1.0.0', root_path="/api", lifespan=lifespan)

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
app.include_router(auth.router)

# Add root route
@app.get("/", tags=["Root"])
async def root():
    return {"message": "Welcome to Wally API!"}

# Add health check route
@app.get("/health", tags=["Root"])
async def health_check():
    return {"status": "ok", "message": "Wally API is running!"}
