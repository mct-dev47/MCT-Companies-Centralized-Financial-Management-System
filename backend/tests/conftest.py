import pytest
from app.core.cache import system_cache


@pytest.fixture(autouse=True)
def reset_system_cache():
    system_cache.clear()
    yield
    system_cache.clear()

