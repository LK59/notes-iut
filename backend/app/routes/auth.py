"""Routes d'authentification : login/refresh (jobs de fond pollés par le client),
logout, /api/me, et gestion des remember-sessions de l'utilisateur courant.

_login_jobs/_login_jobs_lock sont un état en mémoire propre à ce module : /api/login
et /api/refresh y déposent un job que le client poll via /api/login/status et
/api/refresh/status. _cleanup_login_jobs() est aussi appelée périodiquement par
_login_jobs_cleanup_loop (main.py, tâche de fond lancée depuis lifespan()).
"""
from __future__ import annotations

import threading
import time
import uuid

from fastapi import APIRouter, HTTPException, Request, Response

from .. import cache
from ..cas_client import login as cas_login
from ..deps import (
    COOKIE_REMEMBER,
    COOKIE_SID,
    LoginPayload,
    _client_ip,
    _is_admin_username,
    _require_session,
    _set_remember_cookie,
    _set_sid_cookie,
    _user_agent,
)
from ..errors import InvalidCredentials, RememberTokenDecryptError, RememberTokenInvalid, RememberTokenMissing
from ..logging_utils import _log_event, _safe_hash
from ..push_polling import _reauth_warning_for_username
from ..ratelimit import check_rate_limit, MAX_ATTEMPTS_USER
from ..scodoc_payloads import validate_premiere_connexion_payload
from ..sessions import create_session, delete_session, get_session

router = APIRouter()

# Le login CAS enchaîne plusieurs appels HTTPS externes séquentiels (doAuth -> CAS ->
# validation ticket -> data.php) qui peuvent légitimement prendre plusieurs secondes.
# Garder la connexion HTTP du client ouverte et silencieuse pendant tout ce temps est
# le pire cas pour les proxys d'entreprise avec inspection TLS : ils coupent souvent les
# connexions "muettes" bien avant qu'aucun timeout applicatif ne se déclenche. On exécute
# donc le login CAS en tâche de fond et le client poll un statut à intervalles courts :
# chaque requête HTTP dure alors <1s, ce qui ne ressemble plus à une connexion figée.
_login_jobs: dict[str, dict] = {}
_login_jobs_lock = threading.Lock()
LOGIN_JOB_TTL_SECONDS = 180


def _cleanup_login_jobs() -> None:
    cutoff = time.time() - LOGIN_JOB_TTL_SECONDS
    with _login_jobs_lock:
        stale = [job_id for job_id, job in _login_jobs.items() if job["created_at"] < cutoff]
        for job_id in stale:
            _login_jobs.pop(job_id, None)


def _make_stage_updater(job_id: str):
    """Remonte l'étape en cours du login CAS (contacting_site/cas_login/validating_session/
    loading_data) pour que le client affiche une vraie progression pendant le polling."""

    def _update_stage(stage: str) -> None:
        with _login_jobs_lock:
            job = _login_jobs.get(job_id)
            if job is not None and job.get("status") == "pending":
                job["stage"] = stage

    return _update_stage


def _run_login_job(job_id: str, username: str, password: str, remember: bool, user_agent: str | None, client_ip: str | None) -> None:
    started = time.perf_counter()
    try:
        scodoc = cas_login(username, password, on_stage=_make_stage_updater(job_id))
        bootstrap = validate_premiere_connexion_payload(scodoc.bootstrap_data)
        cache.delete_user_cache(username)
        cache.set_semestres(username, bootstrap)
        sid = create_session(username, scodoc)
        remember_token = (
            cache.create_remember_token(username, password, user_agent, client_ip) if remember else None
        )
        _log_event(
            "auth.login.ok",
            username_hash=_safe_hash(username),
            remember=remember,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )
        result = {"status": "ok", "sid": sid, "remember_token": remember_token, "username": username}
    except Exception as exc:  # AppError ou imprévu : rejoué tel quel côté poll
        result = {"status": "error", "error": exc}
    with _login_jobs_lock:
        if job_id in _login_jobs:
            result["created_at"] = _login_jobs[job_id]["created_at"]
            _login_jobs[job_id] = result


@router.post("/api/login")
def api_login(payload: LoginPayload, request: Request):
    client_ip = _client_ip(request) or "unknown"
    username_hash = _safe_hash(payload.username)
    # Double verrou : par IP (attaque distribuée sur plusieurs comptes) et par username
    # (attaque distribuée depuis plusieurs IPs sur un seul compte).
    ip_ok = check_rate_limit(f"login:{client_ip}")
    user_ok = check_rate_limit(f"login:user:{username_hash}", MAX_ATTEMPTS_USER)
    if not ip_ok or not user_ok:
        _log_event("auth.login.rate_limited", username_hash=username_hash, ip_hash=_safe_hash(client_ip))
        raise HTTPException(status_code=429, detail="Trop de tentatives, réessaie dans quelques minutes.")

    _cleanup_login_jobs()
    job_id = uuid.uuid4().hex
    with _login_jobs_lock:
        _login_jobs[job_id] = {"status": "pending", "created_at": time.time()}
    threading.Thread(
        target=_run_login_job,
        args=(job_id, payload.username, payload.password, payload.remember, _user_agent(request), client_ip),
        daemon=True,
    ).start()
    return {"job_id": job_id}


@router.get("/api/login/status/{job_id}")
def api_login_status(job_id: str, response: Response):
    with _login_jobs_lock:
        job = _login_jobs.get(job_id)
        if job is not None and job["status"] != "pending":
            del _login_jobs[job_id]
    if job is None:
        raise HTTPException(status_code=404, detail="Requête de connexion inconnue ou expirée.")
    if job["status"] == "pending":
        return {"status": "pending", "stage": job.get("stage")}
    if job["status"] == "error":
        raise job["error"]

    _set_sid_cookie(response, job["sid"])
    if job.get("remember_token"):
        _set_remember_cookie(response, job["remember_token"])
    return {"status": "ok", "ok": True, "username": job["username"], "isAdmin": _is_admin_username(job["username"])}


def _run_refresh_job(job_id: str, username: str, password: str, old_token: str, user_agent: str | None, client_ip: str | None) -> None:
    try:
        scodoc = cas_login(username, password, on_stage=_make_stage_updater(job_id))
        bootstrap = validate_premiere_connexion_payload(scodoc.bootstrap_data)
        cache.set_semestres(username, bootstrap)
        cache.delete_remember_token(old_token, user_agent, client_ip)
        new_token = cache.create_remember_token(username, password, user_agent, client_ip)
        sid = create_session(username, scodoc)
        _log_event("auth.refresh.ok", username_hash=_safe_hash(username))
        result = {"status": "ok", "sid": sid, "remember_token": new_token, "username": username}
    except InvalidCredentials as exc:
        cache.delete_remember_token(old_token, user_agent, client_ip)
        _log_event("auth.refresh.invalid_credentials_revoked", username_hash=_safe_hash(username))
        result = {"status": "error", "error": exc}
    except Exception as exc:
        result = {"status": "error", "error": exc}
    with _login_jobs_lock:
        if job_id in _login_jobs:
            result["created_at"] = _login_jobs[job_id]["created_at"]
            _login_jobs[job_id] = result


@router.post("/api/refresh")
def api_refresh(request: Request, response: Response):
    """Échange le cookie remember contre une nouvelle session sans ressaisie du mot de passe."""
    client_ip = _client_ip(request) or "unknown"
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
    _cleanup_login_jobs()
    job_id = uuid.uuid4().hex
    with _login_jobs_lock:
        _login_jobs[job_id] = {"status": "pending", "created_at": time.time()}
    threading.Thread(
        target=_run_refresh_job,
        args=(job_id, username, password, token, _user_agent(request), client_ip),
        daemon=True,
    ).start()
    return {"job_id": job_id}


@router.get("/api/refresh/status/{job_id}")
def api_refresh_status(job_id: str, response: Response):
    with _login_jobs_lock:
        job = _login_jobs.get(job_id)
        if job is not None and job["status"] != "pending":
            del _login_jobs[job_id]
    if job is None:
        raise HTTPException(status_code=404, detail="Requête de reconnexion inconnue ou expirée.")
    if job["status"] == "pending":
        return {"status": "pending", "stage": job.get("stage")}
    if job["status"] == "error":
        if isinstance(job["error"], InvalidCredentials):
            response.delete_cookie(COOKIE_REMEMBER, path="/")
        raise job["error"]

    _set_sid_cookie(response, job["sid"])
    _set_remember_cookie(response, job["remember_token"])
    return {"status": "ok", "ok": True, "username": job["username"], "isAdmin": _is_admin_username(job["username"])}


@router.post("/api/logout")
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


@router.get("/api/me")
def api_me(request: Request):
    session = get_session(request.cookies.get(COOKIE_SID))
    if session is None:
        return {"authenticated": False, "canRefresh": bool(request.cookies.get(COOKIE_REMEMBER))}
    return {
        "authenticated": True,
        "username": session.username,
        "isAdmin": _is_admin_username(session.username),
        "reauthWarning": _reauth_warning_for_username(session.username),
    }


@router.delete("/api/cache/me")
def api_clear_my_cache(request: Request):
    session = _require_session(request)
    cache.delete_user_cache(session.username)
    return {"ok": True}


@router.get("/api/me/sessions")
def api_my_sessions(request: Request):
    session = _require_session(request)
    return {
        "sessions": cache.list_remember_sessions(session.username),
        "limits": cache.remember_token_stats(session.username),
    }


@router.delete("/api/me/sessions/{session_id}")
def api_delete_my_session(session_id: str, request: Request):
    session = _require_session(request)
    deleted = cache.delete_remember_session(session.username, session_id, _user_agent(request), _client_ip(request))
    if not deleted:
        raise HTTPException(status_code=404, detail="Session introuvable")
    return {"ok": True}


@router.delete("/api/me/sessions")
def api_delete_all_my_sessions(request: Request, response: Response):
    session = _require_session(request)
    count = cache.delete_all_remember_sessions(session.username, _user_agent(request), _client_ip(request))
    response.delete_cookie(COOKIE_REMEMBER, path="/")
    return {"ok": True, "deleted": count}
