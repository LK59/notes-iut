"""Rate limiting persisté en SQLite (fenêtre glissante)."""
from __future__ import annotations

import json
import time

from .db import _connect

WINDOW_SECONDS = 300
# Plafond du login initial par IP. Volontairement large : au Wi-Fi de l'IUT comme en 4G, une
# promo entière partage une poignée d'IP publiques, et un lundi matin une dizaine de connexions
# en cinq minutes est parfaitement normal. Ce qui protège réellement contre le bourrage
# d'identifiants, c'est le compteur par compte ci-dessous — une attaque distribuée sur un seul
# compte reste bloquée à 20 essais, quelle que soit l'IP d'origine.
MAX_ATTEMPTS_IP = 40
MAX_ATTEMPTS_USER = 20
# Wi-Fi de l'IUT, CGNAT mobile : des dizaines d'étudiants partagent une seule IP publique.
# Un plafond de 10 par IP suffit pour du login interactif, mais pas pour une opération
# déclenchée automatiquement (reconnexion silencieuse au réveil de la PWA) — d'où un
# plafond IP volontairement large, le vrai verrou étant alors posé sur le token.
MAX_ATTEMPTS_SHARED_IP = 60


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


def purge_old_rate_limits() -> None:
    """La table n'était jamais nettoyée : une ligne par IP et par compte, conservée
    indéfiniment. Appelée par la boucle de ménage périodique (main.py)."""
    cutoff = time.time() - WINDOW_SECONDS
    conn = _connect()
    stale = [
        key
        for key, raw in conn.execute("SELECT key, timestamps FROM rate_limit").fetchall()
        if not [t for t in json.loads(raw) if t > cutoff]
    ]
    if not stale:
        return
    try:
        conn.executemany("DELETE FROM rate_limit WHERE key = ?", [(key,) for key in stale])
        conn.commit()
    except Exception:
        conn.rollback()
        raise
