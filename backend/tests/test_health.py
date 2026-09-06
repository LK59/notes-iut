from __future__ import annotations


def test_health_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "version" in body
    assert "build" in body


def test_security_headers_present(client):
    resp = client.get("/api/health")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert "Strict-Transport-Security" in resp.headers
    assert "Content-Security-Policy" in resp.headers


def test_unknown_api_route_returns_json_404(client):
    """Le fallback SPA attrape tout ce qui n'a pas matché. Sans exclusion explicite de
    /api, une route inexistante renvoyait index.html avec un 200 : côté client resp.ok
    était vrai et resp.json() levait une SyntaxError au lieu d'une erreur exploitable."""
    resp = client.get("/api/route-qui-nexiste-pas")
    assert resp.status_code == 404
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json()["error"]["code"] == "HTTP_ERROR"
