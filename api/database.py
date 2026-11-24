from sqlmodel import Session, SQLModel, create_engine, text
from sqlalchemy import inspect, text

engine = create_engine("sqlite:///data/wally.db", connect_args={"check_same_thread": False})

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

    inspector = inspect(engine)

    if "recurringtransaction" in inspector.get_table_names():
        columns = {
            column["name"]
            for column in inspector.get_columns("recurringtransaction")
        }

        if "isSubscription" not in columns:
            with engine.begin() as connection:
                connection.execute(
                    text(
                        'ALTER TABLE recurringtransaction '
                        'ADD COLUMN "isSubscription" BOOLEAN NOT NULL DEFAULT 0'
                    )
                )

def ensure_budget_start_date():
    from .models.budgets import Budget

    table_name = Budget.__tablename__
    with engine.begin() as connection:
        rows = connection.execute(text(f'PRAGMA table_info("{table_name}")')).fetchall()
        if not rows:
            return
        columns = {row[1] for row in rows}
        if "start_date" not in columns:
            connection.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN start_date DATE'))
        connection.execute(text(
            f'UPDATE "{table_name}" SET start_date = date("now") WHERE start_date IS NULL'
        ))

def get_session():
    with Session(engine) as session:
        yield session
