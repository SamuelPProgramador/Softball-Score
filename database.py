import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base


DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

if DATABASE_URL:
    # Hosting: Postgres. Se fuerza el driver psycopg2 (las versiones nuevas de
    # SQLAlchemy usan psycopg 3 por defecto, que no tenemos instalado).
    for prefijo in ("postgresql://", "postgres://"):
        if DATABASE_URL.startswith(prefijo):
            DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len(prefijo):]
            break
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