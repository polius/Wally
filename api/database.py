from sqlmodel import Session, SQLModel, create_engine

# Create the engine to connect to the SQLite database
engine = create_engine("sqlite:///sqlite.db", connect_args={"check_same_thread": False})

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
