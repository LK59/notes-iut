"""Routes de gestion des notifications push (souscription, préférences, test)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from .. import cache
from ..deps import PushPreferencesPayload, PushSubscribePayload, _require_session
from ..logging_utils import logger
from ..push_polling import _send_push

router = APIRouter()


@router.get("/api/push/vapid-key")
def api_push_vapid_key():
    _, pub = cache.get_or_create_vapid_keys()
    return {"vapid_public_key": pub}


@router.post("/api/push/subscribe")
def api_push_subscribe(payload: PushSubscribePayload, request: Request):
    session = _require_session(request)
    _, vapid_public_key = cache.get_or_create_vapid_keys()
    cache.upsert_push_subscription(session.username, payload.endpoint, payload.p256dh, payload.auth, vapid_public_key, payload.includeGradeValue)
    return {"ok": True}


@router.get("/api/push/preferences")
def api_push_preferences(request: Request):
    session = _require_session(request)
    preferences = cache.get_push_preferences(session.username)
    return {"includeGradeValue": preferences["include_grade_value"]}


@router.put("/api/push/preferences")
def api_update_push_preferences(payload: PushPreferencesPayload, request: Request):
    session = _require_session(request)
    cache.set_push_include_grade_value(session.username, payload.includeGradeValue)
    return {"ok": True, "includeGradeValue": payload.includeGradeValue}


@router.delete("/api/push/subscribe")
def api_push_unsubscribe(request: Request):
    session = _require_session(request)
    cache.delete_push_subscriptions(session.username)
    return {"ok": True}


@router.post("/api/push/test")
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
