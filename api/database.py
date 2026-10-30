import os
import logging
import sqlite3
from datetime import date
from pathlib import Path
from sqlalchemy import event, inspect
from sqlmodel import Session, SQLModel, create_engine

log = logging.getLogger("wally")

DATA_DIR = Path(os.getenv("WALLY_DATA", "data"))
DB_PATH = DATA_DIR / "wally.db"
BACKUP_DIR = DATA_DIR / "backups"

# Version 1 is Wally 2.0. Databases from Wally 1.x have no version.
SCHEMA_VERSION = 1

def _on_connect(dbapi_connection, _):
    dbapi_connection.execute("PRAGMA busy_timeout = 5000")

def make_engine(path: Path):
    # Create the engine to connect to the SQLite database
    new_engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
    event.listen(new_engine, "connect", _on_connect)
    return new_engine

engine = make_engine(DB_PATH)

def configure(data_dir: Path):
    """Point Wally at another data folder (used by the tests)."""
    global DATA_DIR, DB_PATH, BACKUP_DIR, engine
    engine.dispose()
    DATA_DIR = Path(data_dir)
    DB_PATH = DATA_DIR / "wally.db"
    BACKUP_DIR = DATA_DIR / "backups"
    engine = make_engine(DB_PATH)
    STATE["read_only"] = None

# Set when an upgrade step failed: Wally then opens read-only and says why
STATE = {"read_only": None}

def import_models():
    # Every table must be registered before create_all
    from .models import app, people, api_keys, transactions, recurring_transactions, categories, tags, currency, money  # noqa: F401

def create_db_and_tables():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    import_models()
    migrate_db()

def get_session():
    with Session(engine) as session:
        yield session

def copy_database(source: Path, target: Path):
    """Copy a SQLite database safely, even while it is open."""
    target.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(source)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()

def _schema_version(conn, tables: set[str]) -> int | None:
    """None for an empty database, 0 for Wally 1.x, otherwise the stored version."""
    if "transaction" not in tables:
        return None
    if "appconfig" in tables:
        row = conn.exec_driver_sql("SELECT value FROM appconfig WHERE key = 'SCHEMA_VERSION'").fetchone()
        if row:
            return int(row[0])
    return 0

def _set_schema_version(conn, version: int):
    conn.exec_driver_sql("INSERT OR REPLACE INTO appconfig (key, value) VALUES ('SCHEMA_VERSION', ?)", (str(version),))

def _add_column(conn, table: str, column: str, ddl: str):
    columns = {c["name"] for c in inspect(conn).get_columns(table)}
    if column not in columns:
        conn.exec_driver_sql(f'ALTER TABLE "{table}" ADD COLUMN {ddl}')

def _step_1(conn, today: date):
    """Wally 1.x to 2.0: people, shared costs, sign-in per person, the recurring engine."""
    # Transactions
    for column, ddl in [
        ("person_id", "person_id INTEGER"),
        ("shares", "shares JSON"),
        ("paid_by", "paid_by INTEGER"),
        ("note", "note VARCHAR NOT NULL DEFAULT ''"),
        ("created_by", "created_by INTEGER"),
        ("import_ref", "import_ref VARCHAR"),
        ("source", "source JSON"),
        ("group_id", "group_id VARCHAR"),
    ]:
        _add_column(conn, "transaction", column, ddl)
    for column in ("person_id", "import_ref", "group_id"):
        conn.exec_driver_sql(f'CREATE INDEX IF NOT EXISTS ix_transaction_{column} ON "transaction" ({column})')

    # API keys belong to a person now
    _add_column(conn, "apikeys", "name", "name VARCHAR NOT NULL DEFAULT ''")
    _add_column(conn, "apikeys", "prefix", "prefix VARCHAR NOT NULL DEFAULT ''")
    _add_column(conn, "apikeys", "person_id", "person_id INTEGER")

    # Recurring rules: SQLite cannot drop NOT NULL from endDate, so the table is rebuilt
    # with every v1 column kept as it was
    for index in inspect(conn).get_indexes("recurringtransaction"):
        conn.exec_driver_sql(f'DROP INDEX IF EXISTS "{index["name"]}"')
    conn.exec_driver_sql("ALTER TABLE recurringtransaction RENAME TO recurringtransaction_v1")
    SQLModel.metadata.tables["recurringtransaction"].create(conn)
    conn.exec_driver_sql(
        'INSERT INTO recurringtransaction (name, category, tags, amount, type, "startDate", "endDate", frequency, id, created_date, '
        'interval, person_id, shares, paid_by, about, note, paused, last_run) '
        'SELECT name, category, tags, amount, type, "startDate", "endDate", frequency, id, created_date, 1, NULL, NULL, NULL, 0, \'\', 0, ? '
        'FROM recurringtransaction_v1',
        (today.isoformat(),),
    )
    conn.exec_driver_sql("DROP TABLE recurringtransaction_v1")

    # v1 created every charge up front, up to the end date. 2.0 never stores future dates:
    # the engine adds each one on its day, and calendars work them out.
    conn.exec_driver_sql('DELETE FROM "transaction" WHERE "recurringID" != \'\' AND date > ?', (today.isoformat(),))

    # People upgrading skip the first-run steps
    conn.exec_driver_sql("INSERT OR REPLACE INTO appconfig (key, value) VALUES ('ONBOARDED', '1')")

STEPS = {1: _step_1}

def migrate_db():
    """Bring the database up to SCHEMA_VERSION in small additive steps.

    Before changing anything, the database is copied to backups/. If a step fails,
    the copy is put back and Wally opens read-only with a banner that says why.
    """
    with engine.connect() as conn:
        tables = set(inspect(conn).get_table_names())
        version = _schema_version(conn, tables)

    if version is None:
        SQLModel.metadata.create_all(engine)
        with engine.begin() as conn:
            _set_schema_version(conn, SCHEMA_VERSION)
        return

    if version >= SCHEMA_VERSION:
        SQLModel.metadata.create_all(engine)
        return

    from .util import today as household_today
    backup = BACKUP_DIR / f"pre-2.0-{household_today().isoformat()}.db"
    copy_database(DB_PATH, backup)
    log.info("Copied the database to %s before upgrading", backup)

    try:
        with engine.begin() as conn:
            for step in range(version + 1, SCHEMA_VERSION + 1):
                STEPS[step](conn, household_today())
            _set_schema_version(conn, SCHEMA_VERSION)
        # New tables (people, sessions, rules)
        SQLModel.metadata.create_all(engine)
    except Exception as error:
        log.exception("Upgrade failed, restoring %s", backup)
        engine.dispose()
        for suffix in ("-wal", "-shm"):
            Path(f"{DB_PATH}{suffix}").unlink(missing_ok=True)
        copy_database(backup, DB_PATH)
        STATE["read_only"] = f"The upgrade to Wally 2.0 failed ({error}). Your data was put back as it was, and Wally is read-only until this is fixed. The copy is in {backup}."
