"""Routes de consultation des données ScoDoc : semestres, relevés, distribution
des notes, bulletin PDF, photo. Toutes nécessitent une session active."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response

from .. import cache
from ..deps import COOKIE_SID, _require_session
from ..errors import AppError, ScodocSessionRejected
from ..logging_utils import logger
from ..scodoc_payloads import validate_premiere_connexion_payload, validate_releve_payload
from ..sessions import UserSession, delete_session

router = APIRouter()


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


@router.get("/api/semestres")
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


@router.get("/api/releve/{semestre_id}")
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


@router.get("/api/distribution/{eval_id}")
def api_distribution(eval_id: str, request: Request):
    session = _require_session(request)
    try:
        data = session.scodoc.liste_notes(eval_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec de l'appel au portail (distribution %s)", eval_id)
        raise HTTPException(status_code=502, detail="Le portail de notes ne répond pas. Réessaie dans quelques minutes.") from exc
    return data


@router.get("/api/bulletin-pdf/{semestre_id}")
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


@router.get("/api/photo")
def api_photo(request: Request):
    session = _require_session(request)
    try:
        content, content_type = session.scodoc.student_photo()
    except Exception as exc:  # noqa: BLE001
        logger.exception("Échec de l'appel au portail (photo)")
        raise HTTPException(status_code=502, detail="Le portail de notes ne répond pas. Réessaie dans quelques minutes.") from exc
    return Response(content=content, media_type=content_type)
