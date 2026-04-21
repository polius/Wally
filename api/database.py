from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

# Create the engine to connect to the SQLite database
engine = create_engine("sqlite:///data/wally.db", connect_args={"check_same_thread": False})

def run_migrations():
    with engine.connect() as conn:
        # Add person column to recurringtransaction if missing
        rows = conn.execute(text("PRAGMA table_info(recurringtransaction)")).fetchall()
        if rows and 'person' not in [r[1] for r in rows]:
            conn.execute(text("ALTER TABLE recurringtransaction ADD COLUMN person TEXT NOT NULL DEFAULT ''"))
            conn.commit()

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    run_migrations()

def get_session():
    with Session(engine) as session:
        yield session
