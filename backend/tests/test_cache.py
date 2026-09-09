from __future__ import annotations

from app import cache


def test_check_rate_limit_allows_up_to_max_attempts():
    key = "test:rl:1"
    for _ in range(5):
        assert cache.check_rate_limit(key, max_attempts=5) is True
    assert cache.check_rate_limit(key, max_attempts=5) is False


def test_check_rate_limit_is_scoped_by_key():
    assert cache.check_rate_limit("test:rl:a", max_attempts=1) is True
    assert cache.check_rate_limit("test:rl:b", max_attempts=1) is True
    assert cache.check_rate_limit("test:rl:a", max_attempts=1) is False


def test_remember_token_round_trip():
    token = cache.create_remember_token("etudiant1", "mon-mdp", "ua-test", "127.0.0.1")
    creds = cache.get_remember_credentials(token, "ua-test", "127.0.0.1")
    assert creds == ("etudiant1", "mon-mdp")


def test_remember_token_invalid_after_delete():
    token = cache.create_remember_token("etudiant1", "mon-mdp", "ua-test", "127.0.0.1")
    cache.delete_remember_token(token, "ua-test", "127.0.0.1")
    assert cache.get_remember_credentials(token, "ua-test", "127.0.0.1") is None


def test_remember_token_unknown_token_returns_none():
    assert cache.get_remember_credentials("not-a-real-token", "ua-test", "127.0.0.1") is None


def test_semestres_cache_round_trip():
    cache.delete_user_cache("etudiant2")
    assert cache.get_semestres("etudiant2") is None
    cache.set_semestres("etudiant2", {"semestres": [{"formsemestre_id": "1"}]})
    assert cache.get_semestres("etudiant2") == {"semestres": [{"formsemestre_id": "1"}]}
    cache.delete_user_cache("etudiant2")
    assert cache.get_semestres("etudiant2") is None


def _forcer_dernier_acces(username: str, il_y_a_secondes: float) -> None:
    """Vieillit le dernier accès d'un jeton sans attendre : les deux TTL se comptent
    depuis last_used_at."""
    import time

    from app.cache.db import _connect

    conn = _connect()
    conn.execute(
        "UPDATE remember_tokens SET last_used_at = ? WHERE username = ?",
        (time.time() - il_y_a_secondes, username),
    )
    conn.commit()


def test_remember_session_expiry_accounts_for_idle_ttl():
    """Régression : la liste n'exposait que l'échéance absolue (30 j), donc un appareil
    inactif depuis un mois s'affichait comme valide alors qu'il était déjà mort par
    inactivité (7 j)."""
    from app.cache.remember import REMEMBER_IDLE_TTL

    cache.delete_all_remember_sessions("etudiant-idle")
    cache.create_remember_token("etudiant-idle", "mdp", "ua-test", "127.0.0.1")
    _forcer_dernier_acces("etudiant-idle", REMEMBER_IDLE_TTL + 3600)

    session = cache.list_remember_sessions("etudiant-idle")[0]
    assert session["expired"] is True
    assert session["effective_expires_at"] == session["idle_deadline"]
    assert session["effective_expires_at"] < session["expires_at"]
    cache.delete_all_remember_sessions("etudiant-idle")


def test_remember_session_marks_current_device():
    cache.delete_all_remember_sessions("etudiant-courant")
    courant = cache.create_remember_token("etudiant-courant", "mdp", "ua-a", "127.0.0.1")
    cache.create_remember_token("etudiant-courant", "mdp", "ua-b", "127.0.0.1")

    sessions = cache.list_remember_sessions("etudiant-courant", courant)
    assert [s["is_current"] for s in sessions].count(True) == 1
    assert all(s["is_current"] is False for s in cache.list_remember_sessions("etudiant-courant"))
    cache.delete_all_remember_sessions("etudiant-courant")


def test_purge_removes_idle_expired_tokens():
    """La purge périodique ne regardait que l'échéance absolue : un jeton mort par
    inactivité restait listé jusqu'à 30 jours."""
    from app.cache.remember import REMEMBER_IDLE_TTL

    cache.delete_all_remember_sessions("etudiant-purge")
    cache.create_remember_token("etudiant-purge", "mdp", "ua-test", "127.0.0.1")
    _forcer_dernier_acces("etudiant-purge", REMEMBER_IDLE_TTL + 3600)

    cache.purge_expired_remember_tokens()
    assert cache.list_remember_sessions("etudiant-purge") == []
