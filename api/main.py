import os
import asyncio
import contextlib
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from . import database
from .database import create_db_and_tables, STATE
from .demo import generate_demo
from .routers import transactions, recurring_transactions, categories, tags, currency, auth, api_keys, me, people, money, data
from .models.app import AppConfig, DEFAULT_CONFIG
from .models.categories import Category, DEFAULT_CATEGORIES
from .models.currency import Currency, DEFAULT_CURRENCIES
from .services.engine import run_all, scheduler

VERSION = "2.0.0"

def init_defaults():
    with Session(database.engine) as db:
        # Create default settings
        for key, value in DEFAULT_CONFIG.items():
            if not db.get(AppConfig, key):
                db.add(AppConfig(key=key, value=("1" if value else "0") if isinstance(value, bool) else str(value)))
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

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Demo version
    if os.getenv("DEMO", "false").lower() == "true":
        generate_demo()

    # Live version
    else:
        create_db_and_tables()

    init_defaults()

    # Catch up every recurring date since the last run, so a server that was off loses nothing
    task = None
    if not STATE["read_only"]:
        with Session(database.engine) as db:
            run_all(db)
        task = asyncio.create_task(scheduler())

    yield  # App is running

    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

# Init FastAPI
# Served under /api: uvicorn runs with --root-path /api (see the Dockerfile)
app = FastAPI(title='Wally API', version=VERSION, lifespan=lifespan)

# Allow your dev frontend origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def read_only_guard(request: Request, call_next):
    """After a failed upgrade the database is back as it was, in the old format, so 2.0 can only
    say what happened. Wally changes nothing until it is fixed."""
    if STATE["read_only"] and not request.url.path.rstrip("/").endswith(("/auth/status", "/health", "/version")):
        return JSONResponse({"detail": STATE["read_only"]}, status_code=503)
    return await call_next(request)

# Add routes
app.include_router(transactions.router)
app.include_router(recurring_transactions.router)
app.include_router(categories.router)
app.include_router(tags.router)
app.include_router(currency.router)
app.include_router(auth.router)
app.include_router(me.router)
app.include_router(people.router)
app.include_router(money.router)
app.include_router(data.router)
app.include_router(api_keys.router)

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
