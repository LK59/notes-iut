"""Sessions serveur en mémoire : associe un cookie opaque à une session CAS authentifiée."""
from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field

from .cas_client import ScodocSession

SESSION_TTL_SECONDS = 60 * 60 * 4  # 4h, aligné sur la durée de vie typique du cookie CAS


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


def create_session(username: str, scodoc: ScodocSession) -> str:
    _purge_expired()
    sid = secrets.token_urlsafe(32)
    _STORE[sid] = UserSession(username=username, scodoc=scodoc)
    return sid


def get_session(sid: str | None) -> UserSession | None:
    if not sid:
        return None
    session = _STORE.get(sid)
    if session is None:
        return None
    if time.time() - session.created_at > SESSION_TTL_SECONDS:
        _STORE.pop(sid, None)
        return None
    return session


def delete_session(sid: str | None) -> None:
    if sid:
        _STORE.pop(sid, None)


def session_stats() -> dict:
    _purge_expired()
    return {
        "active_sessions": len(_STORE),
        "ttl_seconds": SESSION_TTL_SECONDS,
    }
