"""Rate limiting persisté en SQLite (fenêtre glissante)."""
from __future__ import annotations

import json
import time

from .db import _connect

WINDOW_SECONDS = 300
MAX_ATTEMPTS_IP = 10
MAX_ATTEMPTS_USER = 20


def check_rate_limit(key: str, max_attempts: int = MAX_ATTEMPTS_IP) -> bool:
    """False si la clé a dépassé max_attempts tentatives dans la fenêtre glissante.

    Persisté en SQLite : les compteurs survivent aux redémarrages du container.
    La clé peut être forgée côté client si on lui fait confiance sans précaution ;
    s'assurer que `key` contient toujours une valeur contrôlée par le serveur
    (IP réelle depuis X-Real-IP, hash du username, etc.) avant d'appeler cette fonction.
    """
    now = time.time()
    cutoff = now - WINDOW_SECONDS
    conn = _connect()
    row = conn.execute(
        "SELECT timestamps FROM rate_limit WHERE key = ?", (key,)
    ).fetchone()
    timestamps = [t for t in (json.loads(row[0]) if row else []) if t > cutoff]
    if len(timestamps) >= max_attempts:
        return False
    timestamps.append(now)
    conn.execute(
        "INSERT OR REPLACE INTO rate_limit (key, timestamps) VALUES (?, ?)",
        (key, json.dumps(timestamps)),
    )
    conn.commit()
    return True
