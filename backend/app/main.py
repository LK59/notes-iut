from __future__ import annotations

import asyncio
import logging
import os
import json
import time
import hashlib
from contextlib import asynccontextmanager
from pathlib import Path

import requests
import brotli as _brotli

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send
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
from .ratelimit import check_rate_limit, MAX_ATTEMPTS_USER
from .scodoc_payloads import validate_premiere_connexion_payload, validate_releve_payload
from .sessions import UserSession, create_session, delete_session, get_session, session_stats


# ── Push notifications : polling en arrière-plan ──────────────────────────────

PUSH_POLL_INTERVAL = int(os.environ.get("PUSH_POLL_INTERVAL", "600"))  # 10 minutes par défaut
PUSH_INITIAL_DELAY = int(os.environ.get("PUSH_INITIAL_DELAY", "60"))
PUSH_MAX_CONCURRENT_CHECKS = int(os.environ.get("PUSH_MAX_CONCURRENT_CHECKS", "2"))
PUSH_BACKOFF_MAX_SECONDS = int(os.environ.get("PUSH_BACKOFF_MAX_SECONDS", "3600"))
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:notes-iut@example.com")
_push_poll_lock = asyncio.Lock()



def _extract_grade_snapshot(releve: dict) -> dict[str, str | None]:
    result: dict[str, str | None] = {}
    for group in ("ressources", "saes"):
        for mod in (releve.get(group) or {}).values():
            for ev in (mod.get("evaluations") or []):
                ev_id = str(ev.get("id", ""))
                if not ev_id:
                    continue
                note = ev.get("note") or {}
                val = note.get("value") if isinstance(note, dict) else None
                result[ev_id] = str(val) if val is not None else None
    return result


def _find_new_grades(old_snapshot: dict[str, str | None], new_snapshot: dict[str, str | None], releve: dict) -> list[dict]:
    new_grades = []
    for group in ("ressources", "saes"):
        for mod_code, mod in (releve.get(group) or {}).items():
            mod_titre = mod.get("titre") or mod_code
            for ev in (mod.get("evaluations") or []):
                ev_id = str(ev.get("id", ""))
                if not ev_id:
                    continue
                old_val = old_snapshot.get(ev_id)
                new_val = new_snapshot.get(ev_id)
                if old_val is None and new_val is not None:
                    try:
                        float_val = float(new_val)
                        if float_val == float_val:  # pas NaN
                            new_grades.append({
                                "description": ev.get("description") or "Évaluation",
                                "module": f"{mod_code} – {mod_titre}",
                                "value": new_val,
                            })
                    except (ValueError, TypeError):
                        pass
    return new_grades


def _push_message_payload(new_grades: list[dict], include_grade_value: bool) -> dict:
    count = len(new_grades)
    if count > 1:
        return {
            "title": "Plusieurs nouvelles notes sont disponibles",
            "body": "Ouvre Notes IUT pour les consulter.",
            "url": "/",
            "tag": "notes-iut-grade",
        }
    if count == 1:
        g = new_grades[0]
        if include_grade_value:
            return {
                "title": f"Nouvelle note : {g['description']}",
                "body": f"{g['module']} — {g['value']}/20",
                "url": "/",
                "tag": "notes-iut-grade",
            }
        return {
            "title": "Nouvelle note publiée",
            "body": f"{g['module']} — {g['description']}",
            "url": "/",
            "tag": "notes-iut-grade",
        }
    return {"title": "Nouvelle note publiée", "body": "Ouvre Notes IUT pour la consulter.", "url": "/", "tag": "notes-iut-grade"}


def _send_push(subs: list[dict], message: dict) -> int:
    from pywebpush import webpush, WebPushException
    priv_pem, _ = cache.get_or_create_vapid_keys()
    sent = 0
    for sub in subs:
        try:
            webpush(
                subscription_info={"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
                data=json.dumps(message),
                vapid_private_key=priv_pem,
                vapid_claims={"sub": VAPID_SUBJECT},
            )
            sent += 1
            _log_event("push.sent", endpoint_hash=_safe_hash(sub["endpoint"]), tag=message.get("tag"))
        except WebPushException as exc:
            if exc.response is not None and exc.response.status_code in (401, 403, 404, 410):
                cache.delete_push_subscription_by_endpoint(sub["endpoint"])
                _log_event(
                    "push.subscription.deleted",
                    endpoint_hash=_safe_hash(sub["endpoint"]),
                    status_code=exc.response.status_code,
                )
            else:
                _log_event("push.failed", endpoint_hash=_safe_hash(sub["endpoint"]), error=str(exc))
    return sent


def _push_backoff_delay(username: str) -> int:
    state = cache.get_push_poll_state(username)
    failures = int(state.get("failure_count") or 0)
    return min(PUSH_BACKOFF_MAX_SECONDS, PUSH_POLL_INTERVAL * (2 ** min(failures, 6)))


def _push_poll_user(username: str) -> None:
    state = cache.get_push_poll_state(username)
    next_retry_at = state.get("next_retry_at")
    if next_retry_at and time.time() < float(next_retry_at):
        _log_event("push.poll.skipped_backoff", username_hash=_safe_hash(username), next_retry_at=next_retry_at)
        return

    started = time.perf_counter()
    cache.mark_push_poll_started(username)
    creds = cache.get_credentials_for_background(username)
    if not creds:
        cache.mark_push_poll_error(username, "missing_background_credentials", _push_backoff_delay(username))
        _log_event("push.poll.no_credentials", username_hash=_safe_hash(username))
        return
    _username, password = creds
    semestre_id: str | None = None
    try:
        scodoc = cas_login(_username, password)
        bootstrap = validate_premiere_connexion_payload(scodoc.bootstrap_data)
        semestres = bootstrap.get("semestres", [])
        if not semestres:
            cache.mark_push_poll_success(_username, None, 0, False)
            _log_event("push.poll.no_semestres", username_hash=_safe_hash(_username))
            return
        current_semestre = semestres[-1]
        semestre_id = str(current_semestre.get("formsemestre_id", ""))
        if not semestre_id:
            cache.mark_push_poll_success(_username, None, 0, False)
            _log_event("push.poll.no_current_semestre", username_hash=_safe_hash(_username))
            return
        releve_data = validate_releve_payload(scodoc.releve_etudiant(semestre_id))
        releve = releve_data["relevé"]
        current_snapshot = _extract_grade_snapshot(releve)
        stored_snapshot = cache.get_grade_snapshot(_username, semestre_id)
        if stored_snapshot is None:
            cache.set_grade_snapshot(_username, semestre_id, current_snapshot)
            cache.mark_push_poll_success(_username, semestre_id, 0, False)
            _log_event(
                "push.poll.snapshot_initialized",
                username_hash=_safe_hash(_username),
                semestre_id=semestre_id,
                duration_ms=int((time.perf_counter() - started) * 1000),
            )
            return
        new_grades = _find_new_grades(stored_snapshot, current_snapshot, releve)
        sent = 0
        if new_grades:
            subs = cache.get_push_subscriptions(_username)
            _log_event("push.poll.new_grades", username_hash=_safe_hash(_username), count=len(new_grades), subscriptions=len(subs))
            for sub in subs:
                sent += _send_push([sub], _push_message_payload(new_grades, sub.get("include_grade_value", False)))
        else:
            _log_event("push.poll.no_new_grade", username_hash=_safe_hash(_username), semestre_id=semestre_id)
        cache.set_grade_snapshot(_username, semestre_id, current_snapshot)
        cache.mark_push_poll_success(_username, semestre_id, len(new_grades), sent > 0)
        _log_event(
            "push.poll.ok",
            username_hash=_safe_hash(_username),
            semestre_id=semestre_id,
            new_grades=len(new_grades),
            notifications_sent=sent,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )
    except Exception:
        delay = _push_backoff_delay(_username)
        cache.mark_push_poll_error(_username, "scodoc_or_poll_error", delay)
        logger.exception(
            json.dumps(
                {
                    "event": "push.poll.error",
                    "username_hash": _safe_hash(_username),
                    "semestre_id": semestre_id,
                    "retry_delay_seconds": delay,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        )


async def _push_polling_loop() -> None:
    await asyncio.sleep(PUSH_INITIAL_DELAY)  # délai initial au démarrage
    loop = asyncio.get_event_loop()
    while True:
        try:
            if _push_poll_lock.locked():
                _log_event("push.poll.cycle_skipped_overlap")
            else:
                async with _push_poll_lock:
                    usernames = cache.list_subscribed_usernames()
                    _log_event("push.poll.cycle_started", subscribed_users=len(usernames))
                    semaphore = asyncio.Semaphore(max(1, PUSH_MAX_CONCURRENT_CHECKS))

                    async def run_user(username: str) -> None:
                        async with semaphore:
                            try:
                                await loop.run_in_executor(None, _push_poll_user, username)
                            except Exception:
                                logger.exception("Erreur polling push pour un utilisateur")

                    await asyncio.gather(*(run_user(username) for username in usernames))
                    _log_event("push.poll.cycle_finished", subscribed_users=len(usernames))
        except Exception:
            logger.exception("Erreur dans la boucle de polling push")
        await asyncio.sleep(PUSH_POLL_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_push_polling_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


class _BrotliMiddleware:
    """Compresse les réponses en Brotli si le client l'accepte (Accept-Encoding: br).
    Doit être ajouté APRÈS GZipMiddleware (i.e. add_middleware appelé en dernier)
    pour être le wrapper extérieur et avoir la priorité sur gzip."""

    def __init__(self, app: ASGIApp, minimum_size: int = 400, quality: int = 4) -> None:
        self.app = app
        self.minimum_size = minimum_size
        self.quality = quality

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        if b"br" not in headers.get(b"accept-encoding", b""):
            await self.app(scope, receive, send)
            return
        # Masque gzip dans Accept-Encoding pour que GZipMiddleware (inner) ne compresse pas :
        # on gère la compression nous-mêmes dans _BrotliResponder.
        new_headers = [
            (k, b"br") if k == b"accept-encoding" else (k, v)
            for k, v in scope.get("headers", [])
        ]
        scope = {**scope, "headers": new_headers}
        responder = _BrotliResponder(send, self.minimum_size, self.quality)
        await self.app(scope, receive, responder)


class _BrotliResponder:
    def __init__(self, send: Send, minimum_size: int, quality: int) -> None:
        self._send = send
        self.minimum_size = minimum_size
        self.quality = quality
        self._start: Message = {}
        self._chunks: list[bytes] = []

    async def __call__(self, message: Message) -> None:
        if message["type"] == "http.response.start":
            self._start = message
            return
        if message["type"] == "http.response.body":
            self._chunks.append(message.get("body", b""))
            if message.get("more_body", False):
                return
            body = b"".join(self._chunks)
            headers = MutableHeaders(raw=list(self._start.get("headers", [])))
            if len(body) >= self.minimum_size and not headers.get("content-encoding"):
                compressed = _brotli.compress(body, quality=self.quality)
                if len(compressed) < len(body):
                    headers["content-encoding"] = "br"
                    headers["content-length"] = str(len(compressed))
                    vary = headers.get("vary", "")
                    headers["vary"] = f"{vary}, Accept-Encoding".lstrip(", ") if vary else "Accept-Encoding"
                    body = compressed
            self._start["headers"] = headers.raw
            await self._send(self._start)
            await self._send({"type": "http.response.body", "body": body, "more_body": False})


class _ImmutableStaticFiles(StaticFiles):
    """Ajoute Cache-Control: immutable sur les assets hashés par Vite."""

    async def get_response(self, path: str, scope: Scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


app = FastAPI(title="Notes IUT Dashboard", lifespan=lifespan)
# Ordre : GZip ajouté en premier (wrapper intérieur), Brotli ajouté en second (wrapper extérieur).
# Starlette exécute les middlewares en ordre inverse d'ajout → Brotli vérifié en premier,
# si Accept-Encoding: br → compresse en brotli ; sinon la requête traverse jusqu'à GZip.
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(_BrotliMiddleware, minimum_size=400, quality=4)
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
async def csrf_check(request: Request, call_next):
    """Exige X-Requested-With: XMLHttpRequest sur toutes les requêtes mutantes /api/.
    Bloque les soumissions de formulaires cross-origin (CSRF) sans nécessiter de token dédié :
    les navigateurs ne permettent pas d'ajouter ce header sur une requête cross-origin sans
    préflight CORS, et l'API n'a pas de CORS cross-origin configuré."""
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api/"):
        if request.headers.get("X-Requested-With") != "XMLHttpRequest":
            return JSONResponse(
                status_code=403,
                content={"detail": "Requête non autorisée.", "error": {"code": "CSRF_REJECTED", "message": "Requête non autorisée.", "retryable": False}},
            )
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    # style-src 'unsafe-inline' requis pour recharts (inline styles sur les éléments SVG).
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self'; "
        "connect-src 'self'"
    )
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


@app.get("/api/health/deep")
def api_health_deep(request: Request):
    _require_admin(request)
    return _health_deep_data()


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/api/login")
def api_login(payload: LoginPayload, request: Request, response: Response):
    started = time.perf_counter()
    client_ip = _client_ip(request) or "unknown"
    username_hash = _safe_hash(payload.username)
    # Double verrou : par IP (attaque distribuée sur plusieurs comptes) et par username
    # (attaque distribuée depuis plusieurs IPs sur un seul compte).
    ip_ok = check_rate_limit(f"login:{client_ip}")
    user_ok = check_rate_limit(f"login:user:{username_hash}", MAX_ATTEMPTS_USER)
    if not ip_ok or not user_ok:
        _log_event("auth.login.rate_limited", username_hash=username_hash, ip_hash=_safe_hash(client_ip))
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
        "health": _health_deep_data(),
        "sessions": session_stats(),
        "cache": cache.cache_stats(),
        "remember": cache.remember_token_stats(),
        "push": cache.push_poll_stats(),
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
        raise HTTPException(status_code=502, detail="Le portail de notes ne répond pas. Réessaie dans quelques minutes.") from exc

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
        logger.exception("Échec de l'appel au portail (releve %s)", semestre_id)
        raise HTTPException(status_code=502, detail="Le portail de notes ne répond pas. Réessaie dans quelques minutes.") from exc

    cache.set_releve(session.username, semestre_id, data)
    return data


@app.get("/api/distribution/{eval_id}")
def api_distribution(eval_id: str, request: Request):
    session = _require_session(request)
    try:
        data = session.scodoc.liste_notes(eval_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec de l'appel au portail (distribution %s)", eval_id)
        raise HTTPException(status_code=502, detail="Le portail de notes ne répond pas. Réessaie dans quelques minutes.") from exc
    return data


@app.get("/api/bulletin-pdf/{semestre_id}")
def api_bulletin_pdf(semestre_id: str, request: Request, type: str = "BUT"):
    session = _require_session(request)
    try:
        pdf_bytes = session.scodoc.bulletin_pdf(semestre_id, type)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec de l'appel au portail (bulletin-pdf %s)", semestre_id)
        raise HTTPException(status_code=502, detail="Le portail de notes ne répond pas. Réessaie dans quelques minutes.") from exc
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
        logger.exception("Échec de l'appel au portail (photo)")
        raise HTTPException(status_code=502, detail="Le portail de notes ne répond pas. Réessaie dans quelques minutes.") from exc
    return Response(content=content, media_type=content_type)


# ── Push notifications ────────────────────────────────────────────────────────

@app.get("/api/push/vapid-key")
def api_push_vapid_key():
    _, pub = cache.get_or_create_vapid_keys()
    return {"vapid_public_key": pub}


@app.post("/api/push/subscribe")
def api_push_subscribe(payload: PushSubscribePayload, request: Request):
    session = _require_session(request)
    _, vapid_public_key = cache.get_or_create_vapid_keys()
    cache.upsert_push_subscription(session.username, payload.endpoint, payload.p256dh, payload.auth, vapid_public_key, payload.includeGradeValue)
    return {"ok": True}


@app.get("/api/push/preferences")
def api_push_preferences(request: Request):
    session = _require_session(request)
    preferences = cache.get_push_preferences(session.username)
    return {"includeGradeValue": preferences["include_grade_value"]}


@app.put("/api/push/preferences")
def api_update_push_preferences(payload: PushPreferencesPayload, request: Request):
    session = _require_session(request)
    cache.set_push_include_grade_value(session.username, payload.includeGradeValue)
    return {"ok": True, "includeGradeValue": payload.includeGradeValue}


@app.delete("/api/push/subscribe")
def api_push_unsubscribe(request: Request):
    session = _require_session(request)
    cache.delete_push_subscriptions(session.username)
    return {"ok": True}


@app.post("/api/push/test")
def api_push_test(request: Request):
    session = _require_session(request)
    subs = cache.get_push_subscriptions(session.username)
    if not subs:
        raise HTTPException(status_code=404, detail="Aucun abonnement push actif.")
    test_msg = {
        "title": "Test de notification",
        "body": "Les notifications Notes IUT fonctionnent !",
        "url": "/",
        "tag": "notes-iut-test",
    }
    try:
        sent = _send_push(subs, test_msg)
    except Exception as exc:
        logger.exception("Échec du push de test")
        raise HTTPException(status_code=502, detail="Envoi de la notification échoué.") from exc
    if sent == 0:
        raise HTTPException(status_code=410, detail="Abonnement push expiré. Désactive puis réactive les notifications.")
    return {"ok": True}


# ── SPA fallback ──────────────────────────────────────────────────────────────

if FRONTEND_DIST.is_dir():
    app.mount("/assets", _ImmutableStaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    DIST_ROOT = FRONTEND_DIST.resolve()

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        headers = {"Cache-Control": "no-cache, no-store, must-revalidate"}
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_relative_to(DIST_ROOT) and candidate.is_file():
            return FileResponse(candidate, headers=headers)
        return FileResponse(DIST_ROOT / "index.html", headers=headers)
