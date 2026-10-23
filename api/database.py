from sqlalchemy import inspect, text
from sqlmodel import Session, SQLModel, create_engine

# Create the engine to connect to the SQLite database
engine = create_engine("sqlite:///data/wally.db", connect_args={"check_same_thread": False})

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def migrate_db():
    """Add the v2 owner columns to an existing v1 database.

    SQLModel creates missing tables but never adds columns, so this is the
    smallest safe migration for the one deliberate schema change in v2.
    """
    inspector = inspect(engine)
    tables = inspector.get_table_names()

    with engine.begin() as conn:
        if "transaction" in tables or "transactions" in tables:
            table = "transaction" if "transaction" in tables else "transactions"
            columns = {c["name"] for c in inspector.get_columns(table)}
            if "person_id" not in columns:
                conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN person_id VARCHAR'))
                conn.execute(text(f'CREATE INDEX IF NOT EXISTS ix_{table}_person_id ON "{table}" (person_id)'))
            if "shares" not in columns:
                conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN shares JSON DEFAULT \'[]\''))
                conn.execute(text(f'UPDATE "{table}" SET shares = \'[]\' WHERE shares IS NULL'))

        recurring = "recurringtransaction"
        if recurring in tables:
            columns = {c["name"] for c in inspector.get_columns(recurring)}
            if "person_id" not in columns:
                conn.execute(text(f'ALTER TABLE "{recurring}" ADD COLUMN person_id VARCHAR'))
                conn.execute(text(f'CREATE INDEX IF NOT EXISTS ix_{recurring}_person_id ON "{recurring}" (person_id)'))

def get_session():
    with Session(engine) as session:
        yield session
