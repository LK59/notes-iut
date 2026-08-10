"""Routes réservées aux comptes listés dans ADMIN_USERNAMES (voir deps._require_admin)."""
from __future__ import annotations

from fastapi import APIRouter, Request

from .. import cache
from ..app_info import APP_BUILD_ID, APP_VERSION
from ..deps import _admin_usernames, _require_admin
from ..sessions import session_stats
from .health import _health_deep_data

router = APIRouter()


@router.get("/api/admin/status")
def api_admin_status(request: Request):
    admin = _require_admin(request)
    return {
        "admin": admin.username,
        "version": APP_VERSION,
        "build": APP_BUILD_ID,
        "admin_usernames": sorted(_admin_usernames()),
        "health": _health_deep_data(),
        "sessions": session_stats(),
        "cache": cache.cache_stats(),
        "remember": cache.remember_token_stats(),
        "push": cache.push_poll_stats(),
    }


@router.get("/api/admin/remember-sessions")
def api_admin_remember_sessions(request: Request, limit: int = 200):
    _require_admin(request)
    return {"sessions": cache.list_all_remember_sessions(min(max(limit, 1), 500))}


@router.get("/api/admin/remember-events")
def api_admin_remember_events(request: Request, limit: int = 200):
    _require_admin(request)
    return {"events": cache.list_remember_events(min(max(limit, 1), 500))}
