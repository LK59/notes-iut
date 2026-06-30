from __future__ import annotations

import logging
import os
import json
import time
import hashlib
from pathlib import Path

import requests
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import cache
from .build_info import APP_BUILD_ID as GENERATED_APP_BUILD_ID
from .cas_client import login as cas_login
from .cas_client import CAS_BASE, SITE_BASE
from .errors import (
    AppError,
    RememberTokenDecryptError,
    RememberTokenInvalid,
    RememberTokenMissing,
    ScodocSessionRejected,
)
from .ratelimit import check_rate_limit
from .scodoc_payloads import validate_premiere_connexion_payload, validate_releve_payload
from .sessions import UserSession, create_session, delete_session, get_session, session_stats

app = FastAPI(title="Notes IUT Dashboard")
logger = logging.getLogger("notes_iut.api")

COOKIE_SID = "sid"
COOKIE_REMEMBER = "remember"
REMEMBER_MAX_AGE = 60 * 60 * 24 * 30  # 30 jours
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
APP_VERSION = "0.1.0"
APP_BUILD_ID = os.environ.get("APP_BUILD_ID", GENERATED_APP_BUILD_ID)


class LoginPayload(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)
    remember: bool = False


def _admin_usernames() -> set[str]:
    raw = os.environ.get("ADMIN_USERNAMES", "")
    return {item.strip() for item in raw.split(",") if item.strip()}


def _is_admin_username(username: str) -> bool:
    return username in _admin_usernames()


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": exc.message,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "retryable": exc.retryable,
            },
        },
    )


@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else "Erreur HTTP."
    code = "SESSION_EXPIRED" if exc.status_code == 401 else "HTTP_ERROR"
    if exc.status_code == 429:
        code = "RATE_LIMITED"
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": detail,
            "error": {
                "code": code,
                "message": detail,
                "retryable": exc.status_code in (429, 500, 502, 503, 504),
            },
        },
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "private, no-store"
    return response


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
    return request.client.host if request.client else None


def _user_agent(request: Request) -> str | None:
    return request.headers.get("User-Agent")


def _safe_hash(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def _log_event(event: str, **fields) -> None:
    logger.info(json.dumps({"event": event, **fields}, ensure_ascii=False, separators=(",", ":")))


# ── Santé ─────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def api_health():
    return {"status": "ok", "version": APP_VERSION, "build": APP_BUILD_ID}


@app.get("/api/health/deep")
def api_health_deep():
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


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/api/login")
def api_login(payload: LoginPayload, request: Request, response: Response):
    started = time.perf_counter()
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"login:{client_ip}"):
        _log_event("auth.login.rate_limited", username_hash=_safe_hash(payload.username), ip_hash=_safe_hash(client_ip))
        raise HTTPException(status_code=429, detail="Trop de tentatives, réessaie dans quelques minutes.")
    scodoc = cas_login(payload.username, payload.password)
    bootstrap = validate_premiere_connexion_payload(scodoc.bootstrap_data)

    cache.delete_user_cache(payload.username)
    cache.set_semestres(payload.username, bootstrap)
    sid = create_session(payload.username, scodoc)
    _set_sid_cookie(response, sid)

    if payload.remember:
        token = cache.create_remember_token(payload.username, payload.password, _user_agent(request), _client_ip(request))
        _set_remember_cookie(response, token)

    _log_event(
        "auth.login.ok",
        username_hash=_safe_hash(payload.username),
        remember=payload.remember,
        duration_ms=int((time.perf_counter() - started) * 1000),
    )
    return {"ok": True, "username": payload.username, "isAdmin": _is_admin_username(payload.username)}


@app.post("/api/refresh")
def api_refresh(request: Request, response: Response):
    """Échange le cookie remember contre une nouvelle session sans ressaisie du mot de passe."""
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"refresh:{client_ip}"):
        _log_event("auth.refresh.rate_limited", ip_hash=_safe_hash(client_ip))
        raise HTTPException(status_code=429, detail="Trop de tentatives, réessaie dans quelques minutes.")

    token = request.cookies.get(COOKIE_REMEMBER)
    if not token:
        _log_event("auth.refresh.missing_token", ip_hash=_safe_hash(client_ip))
        raise RememberTokenMissing()

    try:
        creds = cache.get_remember_credentials(token, _user_agent(request), _client_ip(request))
    except RememberTokenDecryptError:
        response.delete_cookie(COOKIE_REMEMBER, path="/")
        raise
    if not creds:
        response.delete_cookie(COOKIE_REMEMBER, path="/")
        _log_event("auth.refresh.invalid_token", ip_hash=_safe_hash(client_ip))
        raise RememberTokenInvalid()

    username, password = creds
    scodoc = cas_login(username, password)
    bootstrap = validate_premiere_connexion_payload(scodoc.bootstrap_data)
    cache.delete_user_cache(username)
    cache.set_semestres(username, bootstrap)

    cache.delete_remember_token(token, _user_agent(request), _client_ip(request))
    new_token = cache.create_remember_token(username, password, _user_agent(request), _client_ip(request))
    sid = create_session(username, scodoc)
    _set_sid_cookie(response, sid)
    _set_remember_cookie(response, new_token)
    _log_event("auth.refresh.ok", username_hash=_safe_hash(username))
    return {"ok": True, "username": username, "isAdmin": _is_admin_username(username)}


@app.post("/api/logout")
def api_logout(request: Request, response: Response):
    session = get_session(request.cookies.get(COOKIE_SID))
    if session is not None:
        cache.delete_user_cache(session.username)
    delete_session(request.cookies.get(COOKIE_SID))
    token = request.cookies.get(COOKIE_REMEMBER)
    if token:
        cache.delete_remember_token(token, _user_agent(request), _client_ip(request))
    response.delete_cookie(COOKIE_SID, path="/")
    response.delete_cookie(COOKIE_REMEMBER, path="/")
    _log_event("auth.logout", username_hash=_safe_hash(session.username if session else None))
    return {"ok": True}


@app.get("/api/me")
def api_me(request: Request):
    session = get_session(request.cookies.get(COOKIE_SID))
    if session is None:
        return {"authenticated": False, "canRefresh": bool(request.cookies.get(COOKIE_REMEMBER))}
    return {"authenticated": True, "username": session.username, "isAdmin": _is_admin_username(session.username)}


@app.delete("/api/cache/me")
def api_clear_my_cache(request: Request):
    session = _require_session(request)
    cache.delete_user_cache(session.username)
    return {"ok": True}


@app.get("/api/me/sessions")
def api_my_sessions(request: Request):
    session = _require_session(request)
    return {
        "sessions": cache.list_remember_sessions(session.username),
        "limits": cache.remember_token_stats(session.username),
    }


@app.delete("/api/me/sessions/{session_id}")
def api_delete_my_session(session_id: str, request: Request):
    session = _require_session(request)
    deleted = cache.delete_remember_session(session.username, session_id, _user_agent(request), _client_ip(request))
    if not deleted:
        raise HTTPException(status_code=404, detail="Session introuvable")
    return {"ok": True}


@app.delete("/api/me/sessions")
def api_delete_all_my_sessions(request: Request, response: Response):
    session = _require_session(request)
    count = cache.delete_all_remember_sessions(session.username, _user_agent(request), _client_ip(request))
    response.delete_cookie(COOKIE_REMEMBER, path="/")
    return {"ok": True, "deleted": count}


# ── Admin ────────────────────────────────────────────────────────────────────

@app.get("/api/admin/status")
def api_admin_status(request: Request):
    admin = _require_admin(request)
    return {
        "admin": admin.username,
        "version": APP_VERSION,
        "build": APP_BUILD_ID,
        "admin_usernames": sorted(_admin_usernames()),
        "health": api_health_deep(),
        "sessions": session_stats(),
        "cache": cache.cache_stats(),
        "remember": cache.remember_token_stats(),
    }


@app.get("/api/admin/remember-sessions")
def api_admin_remember_sessions(request: Request, limit: int = 200):
    _require_admin(request)
    return {"sessions": cache.list_all_remember_sessions(min(max(limit, 1), 500))}


@app.get("/api/admin/remember-events")
def api_admin_remember_events(request: Request, limit: int = 200):
    _require_admin(request)
    return {"events": cache.list_remember_events(min(max(limit, 1), 500))}


# ── Données ───────────────────────────────────────────────────────────────────

def _prefetch_releves(session: UserSession, semestres: list) -> None:
    """Précache en arrière-plan les relevés de tous les semestres passés."""
    for s in semestres:
        sid = s.get("formsemestre_id") if isinstance(s, dict) else getattr(s, "formsemestre_id", None)
        if not sid:
            continue
        if cache.get_releve(session.username, sid) is not None:
            continue  # déjà frais en cache
        try:
            data = validate_releve_payload(session.scodoc.releve_etudiant(sid))
            cache.set_releve(session.username, sid, data)
        except Exception:
            pass  # best effort — ne pas bloquer si ScoDoc est lent


@app.get("/api/semestres")
def api_semestres(request: Request, background_tasks: BackgroundTasks):
    session = _require_session(request)

    cached = cache.get_semestres(session.username)
    if cached is not None:
        background_tasks.add_task(_prefetch_releves, session, cached.get("semestres", []))
        return cached

    try:
        data = validate_premiere_connexion_payload(session.scodoc.premiere_connexion())
    except ScodocSessionRejected:
        cache.delete_user_cache(session.username)
        delete_session(request.cookies.get(COOKIE_SID))
        raise
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, AppError):
            raise
        logger.exception("Échec de l'appel dataPremièreConnexion")
        raise HTTPException(status_code=502, detail=f"Erreur lors de l'appel au portail : {exc}") from exc

    cache.set_semestres(session.username, data)
    background_tasks.add_task(_prefetch_releves, session, data.get("semestres", []))
    return data


@app.get("/api/releve/{semestre_id}")
def api_releve(semestre_id: str, request: Request, refresh: bool = False):
    session = _require_session(request)

    if not refresh:
        cached = cache.get_releve(session.username, semestre_id)
        if cached is not None:
            return cached

    try:
        data = validate_releve_payload(session.scodoc.releve_etudiant(semestre_id))
    except ScodocSessionRejected:
        cache.delete_user_cache(session.username)
        delete_session(request.cookies.get(COOKIE_SID))
        raise
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, AppError):
            raise
        raise HTTPException(status_code=502, detail=f"Erreur lors de l'appel au portail : {exc}") from exc

    cache.set_releve(session.username, semestre_id, data)
    return data


@app.get("/api/distribution/{eval_id}")
def api_distribution(eval_id: str, request: Request):
    session = _require_session(request)
    try:
        data = session.scodoc.liste_notes(eval_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Erreur lors de l'appel au portail : {exc}") from exc
    return data


@app.get("/api/bulletin-pdf/{semestre_id}")
def api_bulletin_pdf(semestre_id: str, request: Request, type: str = "BUT"):
    session = _require_session(request)
    try:
        pdf_bytes = session.scodoc.bulletin_pdf(semestre_id, type)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Erreur lors de l'appel au portail : {exc}") from exc
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="bulletin-{semestre_id}.pdf"'},
    )


@app.get("/api/photo")
def api_photo(request: Request):
    session = _require_session(request)
    try:
        content, content_type = session.scodoc.student_photo()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Erreur lors de l'appel au portail : {exc}") from exc
    return Response(content=content, media_type=content_type)


# ── SPA fallback ──────────────────────────────────────────────────────────────

if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    DIST_ROOT = FRONTEND_DIST.resolve()

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        headers = {"Cache-Control": "no-cache, no-store, must-revalidate"}
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_relative_to(DIST_ROOT) and candidate.is_file():
            return FileResponse(candidate, headers=headers)
        return FileResponse(DIST_ROOT / "index.html", headers=headers)
