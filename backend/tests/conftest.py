import os

os.environ.setdefault("TESTING", "1")

import pytest
from app.core.cache import system_cache
from app.core.config import settings
from app.db.session import Base, engine
import app.models  # noqa: F401 — ensure all models are registered on Base.metadata

# Ensure all models are created on the in-memory test database engine
Base.metadata.create_all(bind=engine)


@pytest.fixture(autouse=True)
def reset_system_cache():
    system_cache.clear()
    yield
    system_cache.clear()


