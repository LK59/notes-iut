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
    """Une route /api inexistante doit renvoyer l'enveloppe d'erreur de l'app, que
    frontend/dist soit construit ou non.

    Deux chemins mènent ici selon la présence du build : le fallback SPA (qui doit
    exclure /api, sinon il renvoyait index.html avec un 200 — resp.ok vrai côté client
    et resp.json() levant une SyntaxError), ou le routeur lui-même. Les deux passent
    désormais par le même handler d'exception, d'où ce test valable dans les deux cas."""
    resp = client.get("/api/route-qui-nexiste-pas")
    assert resp.status_code == 404
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json()["error"]["code"] == "HTTP_ERROR"
