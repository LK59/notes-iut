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
