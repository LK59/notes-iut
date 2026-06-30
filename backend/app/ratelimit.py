"""Limiteur de débit en mémoire, simple fenêtre glissante — pour freiner le brute-force sur
/api/login sans gêner un usage normal (quelques essais de connexion par étudiant)."""
from __future__ import annotations

import time
from collections import defaultdict, deque

WINDOW_SECONDS = 300
MAX_ATTEMPTS = 10

_attempts: dict[str, deque[float]] = defaultdict(deque)


def check_rate_limit(key: str) -> bool:
    """Renvoie False si la clé (typiquement une IP) a dépassé MAX_ATTEMPTS sur la fenêtre."""
    now = time.time()
    bucket = _attempts[key]
    while bucket and now - bucket[0] > WINDOW_SECONDS:
        bucket.popleft()
    if len(bucket) >= MAX_ATTEMPTS:
        return False
    bucket.append(now)
    return True
