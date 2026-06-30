from __future__ import annotations

import logging
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import cache
from .cas_client import CasAuthError, login as cas_login
from .ratelimit import check_rate_limit
from .sessions import UserSession, create_session, delete_session, get_session

app = FastAPI(title="Notes IUT Dashboard")
logger = logging.getLogger("notes_iut.api")

COOKIE_SID = "sid"
COOKIE_REMEMBER = "remember"
REMEMBER_MAX_AGE = 60 * 60 * 24 * 30  # 30 jours
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


class LoginPayload(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)
    remember: bool = False


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


# ── Santé ─────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def api_health():
    return {"status": "ok"}


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.post("/api/login")
def api_login(payload: LoginPayload, request: Request, response: Response):
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"login:{client_ip}"):
        raise HTTPException(status_code=429, detail="Trop de tentatives, réessaie dans quelques minutes.")
    try:
        scodoc = cas_login(payload.username, payload.password)
    except CasAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    sid = create_session(payload.username, scodoc)
    _set_sid_cookie(response, sid)

    if payload.remember:
        token = cache.create_remember_token(payload.username, payload.password)
        response.set_cookie(
            COOKIE_REMEMBER,
            token,
            httponly=True,
            secure=True,
            samesite="lax",
            max_age=REMEMBER_MAX_AGE,
            path="/",
        )

    return {"ok": True, "username": payload.username}


@app.post("/api/refresh")
def api_refresh(request: Request, response: Response):
    """Échange le cookie remember contre une nouvelle session sans ressaisie du mot de passe."""
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"refresh:{client_ip}"):
        raise HTTPException(status_code=429, detail="Trop de tentatives, réessaie dans quelques minutes.")

    token = request.cookies.get(COOKIE_REMEMBER)
    if not token:
        raise HTTPException(status_code=401, detail="Aucun token de reconnexion")

    creds = cache.get_remember_credentials(token)
    if not creds:
        response.delete_cookie(COOKIE_REMEMBER, path="/")
        raise HTTPException(status_code=401, detail="Token invalide ou expiré")

    username, password = creds
    try:
        scodoc = cas_login(username, password)
    except CasAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    sid = create_session(username, scodoc)
    _set_sid_cookie(response, sid)
    return {"ok": True, "username": username}


@app.post("/api/logout")
def api_logout(request: Request, response: Response):
    delete_session(request.cookies.get(COOKIE_SID))
    token = request.cookies.get(COOKIE_REMEMBER)
    if token:
        cache.delete_remember_token(token)
    response.delete_cookie(COOKIE_SID, path="/")
    response.delete_cookie(COOKIE_REMEMBER, path="/")
    return {"ok": True}


@app.get("/api/me")
def api_me(request: Request):
    session = get_session(request.cookies.get(COOKIE_SID))
    if session is None:
        return {"authenticated": False}
    return {"authenticated": True, "username": session.username}


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
            data = session.scodoc.releve_etudiant(sid)
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
        data = session.scodoc.premiere_connexion()
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec de l'appel dataPremièreConnexion")
        raise HTTPException(status_code=502, detail=f"Erreur lors de l'appel au portail : {exc}") from exc

    if "semestres" not in data:
        logger.warning("Réponse dataPremièreConnexion inattendue, clés=%r", list(data.keys()))

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
        data = session.scodoc.releve_etudiant(semestre_id)
    except Exception as exc:  # noqa: BLE001
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
