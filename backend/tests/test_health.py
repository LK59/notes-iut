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


def test_log_event_is_emitted_after_configure_logging():
    """Régression : sans configure_logging(), le logger héritait du niveau WARNING du handler
    de dernier recours et les 25 _log_event() du backend ne sortaient nulle part en prod.
    On branche un handler sur un tampon plutôt que d'utiliser capsys : le handler de prod
    capture sys.stdout à l'import de l'app, donc avant toute redirection par pytest."""
    import io
    import logging

    from app.logging_utils import _log_event, configure_logging, logger

    configure_logging()
    assert logger.isEnabledFor(logging.INFO)

    tampon = io.StringIO()
    sonde = logging.StreamHandler(tampon)
    logger.addHandler(sonde)
    try:
        _log_event("test.event", valeur=1)
    finally:
        logger.removeHandler(sonde)
    assert '{"event":"test.event","valeur":1}' in tampon.getvalue()


def test_configure_logging_is_idempotent():
    """Rejouer la config ne doit pas empiler les handlers (donc pas dupliquer chaque ligne)."""
    from app.logging_utils import configure_logging, logger

    configure_logging()
    before = len(logger.handlers)
    configure_logging()
    assert len(logger.handlers) == before
