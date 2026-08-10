"""Helpers de logging structuré, partagés entre les routes et les tâches de fond."""
from __future__ import annotations

import hashlib
import json
import logging

logger = logging.getLogger("notes_iut.api")


def _safe_hash(value: str | None) -> str | None:
    if not value:
        return None
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def _log_event(event: str, **fields) -> None:
    logger.info(json.dumps({"event": event, **fields}, ensure_ascii=False, separators=(",", ":")))
