"""Helpers de logging structuré, partagés entre les routes et les tâches de fond."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import sys

logger = logging.getLogger("notes_iut.api")


def configure_logging() -> None:
    """Sans ça, les _log_event() partaient dans le vide en production : uvicorn ne configure
    que ses propres loggers, la racine reste sans handler, et le logger hérite donc du niveau
    WARNING du handler de dernier recours — tous les événements INFO (push.sent, push.failed,
    push.poll.*, auth.*) étaient perdus. On câble le handler sur notre logger plutôt que sur
    la racine, et sans propagation, pour ne pas dépendre de l'ordre d'initialisation
    d'uvicorn ni dupliquer ses lignes d'accès."""
    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logger.setLevel(level)
    logger.propagate = False
    if any(getattr(h, "_notes_iut", False) for h in logger.handlers):
        return  # déjà configuré : le niveau vient d'être réappliqué ci-dessus
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s %(message)s"))
    handler._notes_iut = True  # type: ignore[attr-defined]
    logger.addHandler(handler)


def _safe_hash(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def _log_event(event: str, **fields) -> None:
    logger.info(json.dumps({"event": event, **fields}, ensure_ascii=False, separators=(",", ":")))
