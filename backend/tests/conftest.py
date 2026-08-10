from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-prod")
os.environ.setdefault("ADMIN_USERNAMES", "adminuser")


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """Redirige le cache SQLite vers un fichier temporaire pour chaque test."""
    import threading

    from app.cache import db as cache_db

    db_path = tmp_path / "cache.db"
    monkeypatch.setattr(cache_db, "DB_PATH", db_path)
    monkeypatch.setattr(cache_db, "VAPID_KEYS_PATH", tmp_path / "vapid.keys")
    monkeypatch.setattr(cache_db, "_thread_local", threading.local())
    monkeypatch.setattr(cache_db, "_db_schema_initialized", False)
    yield


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    from app.sessions import _STORE

    _STORE.clear()
    # base_url en https : les cookies de session sont marqués Secure, un client
    # http://testserver ne les renverrait jamais sur les requêtes suivantes.
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client
    _STORE.clear()


@pytest.fixture
def api_headers():
    """Header requis par le middleware CSRF pour les requêtes mutantes /api/."""
    return {"X-Requested-With": "XMLHttpRequest"}
