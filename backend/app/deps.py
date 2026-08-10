"""Dépendances partagées par (presque) toutes les routes : cookies, session courante,
identité admin, métadonnées de requête (IP réelle, user-agent), payloads d'entrée.
"""
from __future__ import annotations

import os

from fastapi import HTTPException, Request, Response
from pydantic import BaseModel, Field

from .sessions import UserSession, get_session

COOKIE_SID = "sid"
COOKIE_REMEMBER = "remember"
REMEMBER_MAX_AGE = 60 * 60 * 24 * 30  # 30 jours


class LoginPayload(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)
    remember: bool = False


class PushSubscribePayload(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048)
    p256dh: str = Field(min_length=1, max_length=512)
    auth: str = Field(min_length=1, max_length=256)
    includeGradeValue: bool = False


class PushPreferencesPayload(BaseModel):
    includeGradeValue: bool = False


def _admin_usernames() -> set[str]:
    raw = os.environ.get("ADMIN_USERNAMES", "")
    return {item.strip() for item in raw.split(",") if item.strip()}


def _is_admin_username(username: str) -> bool:
    return username in _admin_usernames()


def _require_session(request: Request) -> UserSession:
    session = get_session(request.cookies.get(COOKIE_SID))
    if session is None:
        raise HTTPException(status_code=401, detail="Non authentifié")
    return session


def _require_admin(request: Request) -> UserSession:
    session = _require_session(request)
    if not _is_admin_username(session.username):
        raise HTTPException(status_code=403, detail="Accès admin refusé")
    return session


def _set_sid_cookie(response: Response, sid: str) -> None:
    response.set_cookie(
        COOKIE_SID,
        sid,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=60 * 60 * 4,
        path="/",
    )


def _set_remember_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_REMEMBER,
        token,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=REMEMBER_MAX_AGE,
        path="/",
    )


def _client_ip(request: Request) -> str | None:
    # X-Real-IP est positionné par nginx à $remote_addr — ne peut pas être forgé par le client.
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    # X-Forwarded-For : nginx AJOUTE $remote_addr en dernier via proxy_add_x_forwarded_for.
    # Lire la dernière entrée (ajoutée par le proxy de confiance) et non la première
    # (qui peut être forgée par le client en envoyant un header X-Forwarded-For arbitraire).
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else None


def _user_agent(request: Request) -> str | None:
    return request.headers.get("User-Agent")
