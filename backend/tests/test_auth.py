from __future__ import annotations

import time
from unittest.mock import patch

import requests

from app.cas_client import ScodocSession
from app.errors import InvalidCredentials


def _fake_scodoc_session():
    session = ScodocSession.__new__(ScodocSession)
    session.session = requests.Session()
    session.bootstrap_data = {"semestres": []}
    session.premiere_connexion = lambda: {"semestres": []}
    session.releve_etudiant = lambda sid: {}
    return session


def _login(client, headers, username, password, remember=False, max_attempts=50):
    """POST /api/login lance le job en tâche de fond (voir main.py) : on poll le statut
    jusqu'à résolution, comme le fait le frontend, plutôt que d'attendre une réponse
    synchrone qui n'existe plus."""
    resp = client.post(
        "/api/login",
        json={"username": username, "password": password, "remember": remember},
        headers=headers,
    )
    if resp.status_code != 200:
        return resp
    job_id = resp.json()["job_id"]
    for _ in range(max_attempts):
        status_resp = client.get(f"/api/login/status/{job_id}", headers=headers)
        if status_resp.status_code != 200 or status_resp.json().get("status") != "pending":
            return status_resp
        time.sleep(0.02)
    return status_resp


def test_login_requires_csrf_header(client):
    resp = client.post("/api/login", json={"username": "toto", "password": "secret"})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "CSRF_REJECTED"


def test_login_success_sets_session_cookie(client, api_headers):
    with patch("app.main.cas_login", return_value=_fake_scodoc_session()):
        resp = _login(client, api_headers, "toto", "secret")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"status": "ok", "ok": True, "username": "toto", "isAdmin": False}
    assert "sid" in resp.cookies


def test_login_success_marks_admin(client, api_headers):
    with patch("app.main.cas_login", return_value=_fake_scodoc_session()):
        resp = _login(client, api_headers, "adminuser", "secret")
    assert resp.status_code == 200
    assert resp.json()["isAdmin"] is True


def test_login_invalid_credentials(client, api_headers):
    with patch("app.main.cas_login", side_effect=InvalidCredentials()):
        resp = _login(client, api_headers, "toto", "wrong")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_rate_limited_after_too_many_attempts(client, api_headers):
    with patch("app.main.cas_login", side_effect=InvalidCredentials()):
        for _ in range(10):
            _login(client, api_headers, "flood", "wrong")
        resp = client.post(
            "/api/login",
            json={"username": "flood", "password": "wrong"},
            headers=api_headers,
        )
    assert resp.status_code == 429
    assert resp.json()["error"]["code"] == "RATE_LIMITED"


def test_me_unauthenticated(client):
    resp = client.get("/api/me")
    assert resp.status_code == 200
    assert resp.json()["authenticated"] is False


def test_me_authenticated_after_login(client, api_headers):
    with patch("app.main.cas_login", return_value=_fake_scodoc_session()):
        _login(client, api_headers, "toto", "secret")
    resp = client.get("/api/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["authenticated"] is True
    assert body["username"] == "toto"


def test_logout_clears_session(client, api_headers):
    with patch("app.main.cas_login", return_value=_fake_scodoc_session()):
        _login(client, api_headers, "toto", "secret")
    resp = client.post("/api/logout", headers=api_headers)
    assert resp.status_code == 200
    resp2 = client.get("/api/me")
    assert resp2.json()["authenticated"] is False


def test_protected_endpoint_requires_session(client):
    resp = client.get("/api/semestres")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "SESSION_EXPIRED"


def test_admin_endpoint_forbidden_for_non_admin(client, api_headers):
    with patch("app.main.cas_login", return_value=_fake_scodoc_session()):
        _login(client, api_headers, "toto", "secret")
    resp = client.get("/api/admin/status")
    assert resp.status_code == 403
