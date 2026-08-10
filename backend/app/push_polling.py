"""Polling push en arrière-plan : détecte les nouvelles notes et notifie les abonnés.

Tourne comme tâche de fond lancée depuis lifespan() dans main.py (voir
push_polling_loop). Réutilise la session ScoDoc persistée du dernier poll plutôt
que de refaire un login CAS complet à chaque cycle (voir cache.save_push_session).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time

import requests

from .cas_client import login as cas_login
from .cas_client import DEFAULT_HEADERS, ScodocSession
from . import cache
from .errors import InvalidCredentials, ScodocSessionRejected
from .logging_utils import _log_event, _safe_hash, logger
from .scodoc_payloads import validate_premiere_connexion_payload, validate_releve_payload

PUSH_POLL_INTERVAL = int(os.environ.get("PUSH_POLL_INTERVAL", "600"))  # 10 minutes par défaut
PUSH_INITIAL_DELAY = int(os.environ.get("PUSH_INITIAL_DELAY", "60"))
PUSH_MAX_CONCURRENT_CHECKS = int(os.environ.get("PUSH_MAX_CONCURRENT_CHECKS", "2"))
PUSH_BACKOFF_MAX_SECONDS = int(os.environ.get("PUSH_BACKOFF_MAX_SECONDS", "3600"))
# Étale les vérifications dans le temps au lieu d'un sweep groupé toutes les 10 min (voir
# push_polling_loop) : chaque utilisateur garde une cadence moyenne de PUSH_POLL_INTERVAL,
# mais décalée d'un jitter stable par compte, pour ne pas présenter au CAS/ScoDoc de l'IUT
# une rafale de logins synchronisés depuis la seule IP du serveur.
PUSH_TICK_INTERVAL_SECONDS = int(os.environ.get("PUSH_TICK_INTERVAL_SECONDS", "60"))
PUSH_STAGGER_WINDOW_SECONDS = int(os.environ.get("PUSH_STAGGER_WINDOW_SECONDS", "300"))
REAUTH_WARNING_WINDOW_SECONDS = 24 * 3600
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:notes-iut@example.com")


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


def _reauth_warning_for_username(username: str) -> str | None:
    """"idle" si le remember-token va expirer par inactivité (personne n'a rouvert l'app
    depuis REMEMBER_IDLE_TTL - 24h), "absolute" si c'est son plafond de 30 jours qui approche,
    None sinon. Utilisé à la fois par /api/me (bandeau) et par le polling push (notification)."""
    deadlines = cache.get_background_token_deadlines(username)
    if not deadlines:
        return None
    now = time.time()
    if 0 < deadlines["idle_deadline"] - now <= REAUTH_WARNING_WINDOW_SECONDS:
        return "idle"
    if 0 < deadlines["absolute_deadline"] - now <= REAUTH_WARNING_WINDOW_SECONDS:
        return "absolute"
    return None


def _maybe_send_reauth_warning(username: str) -> None:
    """Notifie une seule fois par token les abonnés push dont la reconnexion automatique
    (remember-token) va bientôt s'arrêter de fonctionner — sans quoi l'expiration est silencieuse :
    plus de polling, plus de reconnexion auto, jusqu'à ce qu'ils ressaisissent leur mot de passe."""
    deadlines = cache.get_background_token_deadlines(username)
    if not deadlines:
        return
    now = time.time()
    token_hash = deadlines["token_hash"]
    warned = cache.get_reauth_warning_state(username)
    subs: list[dict] | None = None

    def _warn_once(deadline: float, field: str, message: dict) -> None:
        nonlocal subs
        if not (0 < deadline - now <= REAUTH_WARNING_WINDOW_SECONDS):
            return
        if warned.get(field) == token_hash:
            return
        if subs is None:
            subs = cache.get_push_subscriptions(username)
        if not subs:
            return
        sent = _send_push(subs, message)
        cache.mark_reauth_warning_sent(username, field, token_hash)
        _log_event("push.reauth_warning.sent", username_hash=_safe_hash(username), kind=field, sent=sent)

    _warn_once(
        deadlines["idle_deadline"],
        "idle_warning_token_hash",
        {
            "title": "Ouvre l'app pour garder tes notifications",
            "body": "Tu n'as pas ouvert Notes IUT depuis un moment : ta connexion va bientôt expirer.",
            "url": "/",
            "tag": "notes-iut-reauth-idle",
        },
    )
    _warn_once(
        deadlines["absolute_deadline"],
        "absolute_warning_token_hash",
        {
            "title": "Reconnexion nécessaire bientôt",
            "body": "Reconnecte-toi dans l'app pour continuer à recevoir tes notes.",
            "url": "/",
            "tag": "notes-iut-reauth-absolute",
        },
    )


def _push_scodoc_session_and_bootstrap(username: str, password: str) -> tuple[ScodocSession, dict]:
    """Réutilise la session ScoDoc persistée du dernier poll plutôt que de refaire un login
    CAS complet à chaque cycle (voir save_push_session). Retombe sur un login complet si la
    session réutilisée est rejetée (cookie expiré côté CAS) ou absente."""
    cookies = cache.get_push_session(username)
    if cookies:
        http_session = requests.Session()
        http_session.headers.update(DEFAULT_HEADERS)
        http_session.cookies.update(cookies)
        scodoc = ScodocSession(session=http_session)
        try:
            bootstrap = validate_premiere_connexion_payload(scodoc.premiere_connexion())
            cache.save_push_session(username, http_session.cookies.get_dict())
            return scodoc, bootstrap
        except Exception as exc:
            # Session rejetée (cas propre) ou erreur ambiguë (réseau, réponse invalide) : dans
            # les deux cas on retombe sur un login CAS complet plutôt que d'abandonner le poll,
            # comme avant l'introduction de la réutilisation de session.
            _log_event(
                "push.poll.session_reuse_failed",
                username_hash=_safe_hash(username),
                error=str(exc),
                rejected=isinstance(exc, ScodocSessionRejected),
            )

    scodoc = cas_login(username, password)
    bootstrap = validate_premiere_connexion_payload(scodoc.bootstrap_data)
    cache.save_push_session(username, scodoc.session.cookies.get_dict())
    return scodoc, bootstrap


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
    try:
        _maybe_send_reauth_warning(_username)
    except Exception:
        logger.exception("Erreur envoi avertissement de reconnexion")
    semestre_id: str | None = None
    try:
        scodoc, bootstrap = _push_scodoc_session_and_bootstrap(_username, password)
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
    except InvalidCredentials:
        deleted = cache.delete_all_remember_sessions(_username)
        cache.mark_push_poll_error(_username, "invalid_credentials_revoked", 0)
        logger.warning(
            json.dumps(
                {
                    "event": "push.poll.invalid_credentials_revoked",
                    "username_hash": _safe_hash(_username),
                    "tokens_deleted": deleted,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
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


def _user_stagger_offset_seconds(username: str) -> int:
    """Décalage stable par compte (dérivé d'un hash, pas re-tiré à chaque tick) : fait
    dériver la cadence individuelle de chaque utilisateur autour de PUSH_POLL_INTERVAL au
    lieu d'un sweep synchronisé de tout le monde toutes les 10 minutes pile."""
    digest = hashlib.sha256(username.encode()).digest()
    return int.from_bytes(digest[:4], "big") % max(1, PUSH_STAGGER_WINDOW_SECONDS)


async def push_polling_loop() -> None:
    """Tick léger et fréquent plutôt qu'un sweep groupé toutes les PUSH_POLL_INTERVAL : chaque
    utilisateur est vérifié dès que sa propre échéance (dernier check + intervalle + jitter
    stable) est passée, ce qui étale les checks — et donc les logins CAS de secours — dans le
    temps au lieu de présenter une rafale synchronisée depuis l'IP du serveur."""
    await asyncio.sleep(PUSH_INITIAL_DELAY)  # délai initial au démarrage
    loop = asyncio.get_event_loop()
    semaphore = asyncio.Semaphore(max(1, PUSH_MAX_CONCURRENT_CHECKS))
    inflight: set[str] = set()

    async def run_user(username: str) -> None:
        try:
            async with semaphore:
                try:
                    await loop.run_in_executor(None, _push_poll_user, username)
                except Exception:
                    logger.exception("Erreur polling push pour un utilisateur")
        finally:
            inflight.discard(username)

    while True:
        try:
            now = time.time()
            usernames = cache.list_subscribed_usernames()
            due = []
            for username in usernames:
                if username in inflight:
                    continue
                state = cache.get_push_poll_state(username)
                next_retry_at = state.get("next_retry_at")
                if next_retry_at and now < float(next_retry_at):
                    continue
                last_started_at = state.get("last_started_at")
                due_interval = PUSH_POLL_INTERVAL + _user_stagger_offset_seconds(username)
                if last_started_at and now - float(last_started_at) < due_interval:
                    continue
                due.append(username)
            if due:
                _log_event("push.poll.tick", due=len(due), subscribed_users=len(usernames))
                for username in due:
                    inflight.add(username)
                    asyncio.create_task(run_user(username))
            orphaned = cache.purge_orphaned_push_sessions()
            if orphaned:
                _log_event("push.session_cache.orphans_purged", count=orphaned)
        except Exception:
            logger.exception("Erreur dans la boucle de polling push")
        await asyncio.sleep(PUSH_TICK_INTERVAL_SECONDS)
