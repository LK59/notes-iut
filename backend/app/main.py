from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import cache
from .cas_client import CasAuthError, login as cas_login
from .sessions import create_session, delete_session, get_session

app = FastAPI(title="Notes IUT Dashboard")
logger = logging.getLogger("notes_iut.api")

COOKIE_NAME = "sid"
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


class LoginPayload(BaseModel):
    username: str
    password: str


def _require_session(request: Request):
    session = get_session(request.cookies.get(COOKIE_NAME))
    if session is None:
        raise HTTPException(status_code=401, detail="Non authentifié")
    return session


@app.post("/api/login")
def api_login(payload: LoginPayload, response: Response):
    try:
        scodoc = cas_login(payload.username, payload.password)
    except CasAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    sid = create_session(payload.username, scodoc)
    response.set_cookie(
        COOKIE_NAME,
        sid,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=60 * 60 * 4,
        path="/",
    )
    return {"ok": True, "username": payload.username}


@app.post("/api/logout")
def api_logout(request: Request, response: Response):
    delete_session(request.cookies.get(COOKIE_NAME))
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/me")
def api_me(request: Request):
    session = get_session(request.cookies.get(COOKIE_NAME))
    if session is None:
        return {"authenticated": False}
    return {"authenticated": True, "username": session.username}


@app.get("/api/semestres")
def api_semestres(request: Request):
    session = _require_session(request)
    try:
        data = session.scodoc.premiere_connexion()
    except Exception as exc:  # noqa: BLE001 - on relaie l'erreur réseau/scraping au client
        logger.exception("Échec de l'appel dataPremièreConnexion")
        raise HTTPException(status_code=502, detail=f"Erreur lors de l'appel au portail : {exc}") from exc
    if "semestres" not in data:
        # On ne logge que les clés, pas le contenu : ce payload contient des données
        # personnelles (notes, identité) d'un utilisateur potentiellement différent à chaque appel.
        logger.warning("Réponse dataPremièreConnexion inattendue, clés=%r", list(data.keys()))
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
    """Notes anonymisées de toute la promo pour une évaluation — pas toujours activé côté admin ScoDoc."""
    session = _require_session(request)
    try:
        data = session.scodoc.liste_notes(eval_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Erreur lors de l'appel au portail : {exc}") from exc
    return data


@app.get("/api/bulletin-pdf/{semestre_id}")
def api_bulletin_pdf(semestre_id: str, request: Request, type: str = "BUT"):
    """Bulletin officiel ScoDoc — pas l'export navigateur, le vrai document généré par l'établissement."""
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


if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        candidate = FRONTEND_DIST / full_path
        # index.html référence des assets au nom hashé (cache-bustés à chaque build) : il ne
        # doit jamais être mis en cache par le navigateur/Cloudflare, sinon un déploiement peut
        # sembler ne rien changer (l'ancien JS continue d'être chargé indéfiniment).
        headers = {"Cache-Control": "no-cache, no-store, must-revalidate"}
        if full_path and candidate.is_file():
            return FileResponse(candidate, headers=headers)
        return FileResponse(FRONTEND_DIST / "index.html", headers=headers)
