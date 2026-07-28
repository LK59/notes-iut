"""Sessions serveur : associe un cookie opaque à une session CAS authentifiée.

Persistées en SQLite (cookies chiffrés) en plus du cache mémoire, pour survivre
aux redémarrages du process (déploiement, restart déclenché par le healthcheck)
sans forcer chaque utilisateur connecté à se reconnecter."""
from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass, field

import requests

from . import cache
from .cas_client import DEFAULT_HEADERS, ScodocSession

SESSION_TTL_SECONDS = 60 * 60 * 4  # 4h, aligné sur la durée de vie typique du cookie CAS

logger = logging.getLogger("notes_iut.sessions")


@dataclass
class UserSession:
    username: str
    scodoc: ScodocSession
    created_at: float = field(default_factory=time.time)


_STORE: dict[str, UserSession] = {}


def _purge_expired() -> None:
    now = time.time()
    expired = [sid for sid, s in _STORE.items() if now - s.created_at > SESSION_TTL_SECONDS]
    for sid in expired:
        _STORE.pop(sid, None)
        cache.delete_session_row(sid)
    cache.purge_expired_sessions(now - SESSION_TTL_SECONDS)


def create_session(username: str, scodoc: ScodocSession) -> str:
    _purge_expired()
    sid = secrets.token_urlsafe(32)
    session = UserSession(username=username, scodoc=scodoc)
    _STORE[sid] = session
    cache.save_session(sid, username, scodoc.session.cookies.get_dict(), session.created_at)
    return sid


def get_session(sid: str | None) -> UserSession | None:
    if not sid:
        return None
    session = _STORE.get(sid)
    if session is None:
        return None
    if time.time() - session.created_at > SESSION_TTL_SECONDS:
        _STORE.pop(sid, None)
        cache.delete_session_row(sid)
        return None
    return session


def delete_session(sid: str | None) -> None:
    if sid:
        _STORE.pop(sid, None)
        cache.delete_session_row(sid)


def restore_sessions() -> int:
    """Recharge en mémoire les sessions persistées, appelé une fois au démarrage."""
    now = time.time()
    restored = 0
    for sid, username, cookies, created_at in cache.load_sessions():
        if now - created_at > SESSION_TTL_SECONDS:
            cache.delete_session_row(sid)
            continue
        http_session = requests.Session()
        http_session.headers.update(DEFAULT_HEADERS)
        http_session.cookies.update(cookies)
        _STORE[sid] = UserSession(
            username=username,
            scodoc=ScodocSession(session=http_session),
            created_at=created_at,
        )
        restored += 1
    if restored:
        logger.info("Sessions restaurées depuis le cache : %d", restored)
    return restored


def session_stats() -> dict:
    _purge_expired()
    return {
        "active_sessions": len(_STORE),
        "ttl_seconds": SESSION_TTL_SECONDS,
    }
