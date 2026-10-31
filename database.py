import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base


DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

if DATABASE_URL:
    # Hosting: Postgres. Algunos servicios entregan "postgres://", que SQLAlchemy no acepta.
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=300)
else:
    # Local: SQLite
    engine = create_engine(
        "sqlite:///./softball.db",
        connect_args={"check_same_thread": False},
    )
SessionLocal = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()