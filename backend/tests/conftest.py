"""Shared test fixtures. Tests never touch the developer's ceasefire.db."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import User
from app.security import hash_password, utcnow


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False, future=True)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def user(db):
    row = User(
        email="sara@northwind-supply.com",
        password_hash=hash_password("correct-horse-battery"),
        organisation="Northwind Supply",
        created_at=utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def client(db):
    """TestClient wired to the in-memory DB. Lifespan is not run, so the real
    ceasefire.db is never touched."""
    from fastapi.testclient import TestClient

    from app.db import get_db
    from app.main import app

    app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def auth_client(client, db, user):
    """A client already carrying a valid session cookie for `user`."""
    from app.config import settings
    from app.security import create_session

    client.cookies.set(settings.session_cookie_name, create_session(db, user))
    return client
