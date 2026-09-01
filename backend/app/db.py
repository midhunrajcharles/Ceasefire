"""Engine, session factory, declarative Base, and the request-scoped DB dependency."""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings

_is_sqlite = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    # SQLite only: FastAPI serves requests on a thread pool, so the connection
    # must not be pinned to the thread that created it.
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_pre_ping=not _is_sqlite,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_all() -> None:
    """Create every table. No Alembic until the schema stabilises (§4)."""
    from . import models  # noqa: F401  — import registers the mappers on Base

    Base.metadata.create_all(bind=engine)
