import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select

from .database import create_db_and_tables, engine
from .demo import generate_demo
from .routers import transactions, recurring_transactions, categories, tags, currency, auth
from .models.app import AppConfig, DEFAULT_CONFIG
from .models.categories import Category, DEFAULT_CATEGORIES
from .models.currency import Currency, DEFAULT_CURRENCIES

VERSION = "1.8"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Demo version
    if os.getenv("DEMO", "false").lower() == "true":
        generate_demo()

    # Live version
    else:
        # Create database and tables
        create_db_and_tables()

        # Init database session
        with Session(engine) as db:
            # Create default settings
            for key, value in DEFAULT_CONFIG.items():
                if not db.get(AppConfig, key):
                    db.add(AppConfig(key=key, value=value))
            db.commit()

            # Create default categories if table is empty
            if not db.exec(select(Category).limit(1)).first():
                db.bulk_insert_mappings(Category, DEFAULT_CATEGORIES)
                db.commit()

            # Create default currencies
            for item in DEFAULT_CURRENCIES:
                if not db.get(Currency, item['name']):
                    db.add(Currency(**item))
            db.commit()

    yield  # App is running

# Init FastAPI
app = FastAPI(title='Wally API', version=VERSION, lifespan=lifespan, root_path="/api")

# Allow your dev frontend origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500"],
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

# Add health check route
@app.get("/version", tags=["Root"])
async def version():
    return {"version": VERSION}
