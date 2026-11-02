import os
import re
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
from .routers import transactions, recurring_transactions, categories, tags, currency, auth, api_keys, me, people, money, data, vault, kit
from .services import conversion, sealed_view
from .services.vault import load_state, purge_tombstones, required
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

        # Create default categories if table is empty (with encryption on, categories are sealed records)
        if not database.STATE.get("vault") and not db.exec(select(Category).limit(1)).first():
            db.bulk_insert_mappings(Category, DEFAULT_CATEGORIES)
            db.commit()

        # Create default currencies
        for item in DEFAULT_CURRENCIES:
            if not db.get(Currency, item['name']):
                db.add(Currency(**item))
        db.commit()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Turning encryption on or off was cut short: finish it, or undo it, before anything opens the database
    if database.DATA_DIR.exists():
        conversion.recover_on_start()

    # Demo version
    if os.getenv("DEMO", "false").lower() == "true":
        generate_demo()

    # Live version
    else:
        create_db_and_tables()

    # After a failed upgrade the old database is back exactly as it was: nothing more is written to it
    if not STATE["read_only"]:
        with Session(database.engine) as db:
            load_state(db)
            if STATE["vault"]:
                purge_tombstones(db)
        init_defaults()

    # Catch up every recurring date since the last run, so a server that was off loses nothing.
    # With encryption on, the server can't read the rules: each browser does this when it opens.
    task = None
    if not STATE["read_only"]:
        if not STATE["vault"]:
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

# With encryption on, the household's data is sealed records the server can't read: these answer
# from the browser instead (js/vault/local.js), and the server says so if asked
PLAIN_DATA = re.compile(r"^/(transactions|ledger|recurring|categories|tags|summary|import|rules)(/|$)|^/people/(\d+/usage|\d+/from-tag|from-tags?)(/|$)|^/backups/(.+/restore|upload)$")
# What an API key can't do while Wally is encrypted: backups are sealed files, put back from the app
KEYS_NEVER = re.compile(r"^/backups/")
# While encryption is being turned on or off, the household is read-only except for these
DURING_PAUSE = re.compile(r"^/(vault/convert/|logout|login|vault/kdf|auth/status)")

def _api_path(request: Request) -> str:
    path, root = request.url.path, request.scope.get("root_path", "")
    if root and path.startswith(root):
        path = path[len(root):]
    if path.startswith("/api/"):
        path = path[4:]
    return path.rstrip("/") or "/"

@app.middleware("http")
async def guards(request: Request, call_next):
    """After a failed upgrade the database is back as it was, in the old format, so 2.0 can only
    say what happened. Wally changes nothing until it is fixed."""
    if STATE["read_only"] and not request.url.path.rstrip("/").endswith(("/auth/status", "/health", "/version")):
        return JSONResponse({"detail": STATE["read_only"]}, status_code=503)
    # The moment the new database file is put in place: everything waits for it
    for _ in range(300):
        if not STATE.get("switching"):
            break
        await asyncio.sleep(0.05)
    else:
        return JSONResponse({"detail": "Wally is busy for a moment. Try again."}, status_code=503)
    path = _api_path(request)
    conversion.check_expired()
    paused = conversion.paused_detail()
    if paused and request.method not in ("GET", "HEAD", "OPTIONS") and not DURING_PAUSE.match(path):
        doing = "encrypting Wally" if paused["direction"] == "on" else "turning off encryption"
        return JSONResponse({"detail": {"message": f"{paused['by']} is {doing}. Back in a minute.", "paused": paused}}, status_code=503)
    raw_key = request.headers.get("x-api-key")
    sealed = bool(STATE.get("vault") and PLAIN_DATA.match(path))
    if sealed and not (raw_key and not KEYS_NEVER.match(path)):
        return JSONResponse({"detail": "Wally is encrypted: this data is kept by your browser, not the server."}, status_code=409)
    if required() and not STATE.get("vault") and PLAIN_DATA.match(path) and request.method not in ("GET", "HEAD", "OPTIONS"):
        # Nothing is saved in the clear on a server that promises to encrypt everything
        return JSONResponse({"detail": "This server keeps every household encrypted. Turn on encryption in Settings › Privacy first."}, status_code=409)
    STATE["inflight"] = STATE.get("inflight", 0) + 1
    try:
        if sealed:
            # An API key on an encrypted household: the data opened for this call alone
            return await sealed_view.serve(request, call_next, raw_key)
        return await call_next(request)
    finally:
        STATE["inflight"] -= 1

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
app.include_router(vault.router)
app.include_router(kit.router)

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
