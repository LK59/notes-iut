from __future__ import annotations

import asyncio
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

import brotli as _brotli

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import cache
from .errors import AppError
from .logging_utils import configure_logging, logger
from .push_polling import push_polling_loop
from .routes import admin, auth, data, health, push
from .routes.auth import _cleanup_login_jobs
from .sessions import restore_sessions


configure_logging()

LOGIN_JOBS_CLEANUP_INTERVAL_SECONDS = 60


async def _login_jobs_cleanup_loop() -> None:
    """_cleanup_login_jobs() n'était sinon appelé que lors d'un nouveau /api/login ou
    /api/refresh : un job terminé mais jamais repollé (onglet fermé en plein login,
    par ex.) restait donc en mémoire indéfiniment en période creuse."""
    while True:
        await asyncio.sleep(LOGIN_JOBS_CLEANUP_INTERVAL_SECONDS)
        try:
            _cleanup_login_jobs()
        except Exception:
            logger.exception("Erreur nettoyage périodique des login jobs")
        try:
            cache.purge_expired_remember_tokens()
        except Exception:
            logger.exception("Erreur purge des remember-tokens expirés")
        try:
            cache.purge_old_remember_events()
        except Exception:
            logger.exception("Erreur purge des remember-events périmés")
        try:
            cache.purge_old_rate_limits()
        except Exception:
            logger.exception("Erreur purge des compteurs de rate-limit")


@asynccontextmanager
async def lifespan(app: FastAPI):
    restore_sessions()
    push_task = asyncio.create_task(push_polling_loop())
    cleanup_task = asyncio.create_task(_login_jobs_cleanup_loop())
    yield
    for task in (push_task, cleanup_task):
        task.cancel()
    for task in (push_task, cleanup_task):
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


# Types déjà compressés par nature : les recompresser coûte du CPU (et de la mémoire,
# la réponse étant mise en tampon en entier) pour un gain nul, voire négatif. Concerne
# surtout /api/bulletin-pdf et /api/photo, les deux plus grosses réponses de l'app.
_INCOMPRESSIBLE_PREFIXES = ("image/", "video/", "audio/", "font/", "application/pdf", "application/zip")


def _is_incompressible(content_type: str) -> bool:
    return content_type.split(";")[0].strip().lower().startswith(_INCOMPRESSIBLE_PREFIXES)


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
            if (
                len(body) >= self.minimum_size
                and not headers.get("content-encoding")
                and not _is_incompressible(headers.get("content-type", ""))
            ):
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

FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


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


# Enregistré sur l'exception de Starlette, dont celle de FastAPI hérite : un seul
# handler couvre donc les deux. Enregistré sur celle de FastAPI seule, il laissait
# passer les 404 levées par le routeur lui-même (route inexistante), qui repartaient
# avec le format par défaut `{"detail": "Not Found"}` au lieu de l'enveloppe d'erreur
# de l'app. Cas visible uniquement quand frontend/dist est absent — donc en CI, et
# pas en local où le fallback SPA attrapait la requête avant le routeur.
@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException):
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
        "connect-src 'self'; "
        # Durcissements sans effet sur l'app : aucun plugin, aucune <base>, et
        # l'app n'a jamais vocation à être encadrée dans une autre page.
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "private, no-store"
    return response


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(data.router)
app.include_router(push.router)


# ── SPA fallback ──────────────────────────────────────────────────────────────

if FRONTEND_DIST.is_dir():
    app.mount("/assets", _ImmutableStaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    # Polices auto-hébergées (la CSP interdit font-src externe). Servies par StaticFiles
    # plutôt que par le fallback SPA : celui-ci les renvoyait en text/plain avec
    # "no-store", donc retéléchargées à chaque navigation. Leur contenu ne change jamais
    # sans changement de nom de fichier, d'où le même Cache-Control immutable que les assets.
    fonts_dir = FRONTEND_DIST / "fonts"
    if fonts_dir.is_dir():
        mimetypes.add_type("font/woff2", ".woff2")
        app.mount("/fonts", _ImmutableStaticFiles(directory=fonts_dir), name="fonts")

    DIST_ROOT = FRONTEND_DIST.resolve()

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        # Sans ça, une route /api inexistante (faute de frappe, endpoint retiré) renvoyait
        # index.html avec un 200 : côté client, resp.ok était vrai et resp.json() levait une
        # SyntaxError incompréhensible au lieu d'une erreur 404 exploitable.
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Ressource introuvable.")
        headers = {"Cache-Control": "no-cache, no-store, must-revalidate"}
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_relative_to(DIST_ROOT) and candidate.is_file():
            return FileResponse(candidate, headers=headers)
        return FileResponse(DIST_ROOT / "index.html", headers=headers)
