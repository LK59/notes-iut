"""Routes de santé : /api/health (publique, légère) et /api/health/deep (admin, vérifie
la base, le CAS et ScoDoc distants). _health_deep_data() est réutilisée telle quelle par
/api/admin/status (routes/admin.py)."""
from __future__ import annotations

import requests
from fastapi import APIRouter, Request

from .. import cache
from ..app_info import APP_BUILD_ID, APP_VERSION
from ..cas_client import CAS_BASE, SITE_BASE
from ..deps import _require_admin

router = APIRouter()


@router.get("/api/health")
def api_health():
    return {"status": "ok", "version": APP_VERSION, "build": APP_BUILD_ID}


def _health_deep_data() -> dict:
    checks: dict[str, str] = {"api": "ok"}
    config: dict[str, str] = {}
    remember_stats: dict | None = None
    try:
        checks["database"] = "ok" if cache.check_database() else "down"
        checks["remember"] = "ok"
        remember_stats = cache.remember_token_stats()
        config["encryption_key_source"] = cache.encryption_key_source()
    except Exception:
        checks["database"] = "down"
        checks["remember"] = "down"

    for name, url in (("cas", CAS_BASE), ("scodoc", SITE_BASE)):
        try:
            resp = requests.get(url, timeout=4)
            checks[name] = "ok" if resp.status_code < 500 else "degraded"
        except requests.Timeout:
            checks[name] = "timeout"
        except requests.RequestException:
            checks[name] = "down"

    status = "ok" if all(v == "ok" for v in checks.values()) else "degraded"
    return {
        "status": status,
        "version": APP_VERSION,
        "build": APP_BUILD_ID,
        "checks": checks,
        "config": config,
        "remember": remember_stats,
    }


@router.get("/api/health/deep")
def api_health_deep(request: Request):
    _require_admin(request)
    return _health_deep_data()
