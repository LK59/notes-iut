"""Sessions serveur persistées et session ScoDoc réutilisée par le polling push.

Les cookies de session ScoDoc/CAS sont chiffrés comme un mot de passe : ils
donnent un accès complet au compte tant que la session CAS distante est valide.
"""
from __future__ import annotations

import json
import time

from cryptography.fernet import InvalidToken

from .db import _connect
from .secrets import _get_fernet


def save_session(sid: str, username: str, cookies: dict[str, str], created_at: float) -> None:
    encrypted = _get_fernet().encrypt(json.dumps(cookies).encode()).decode()
    conn = _connect()
    conn.execute(
        "INSERT OR REPLACE INTO sessions (sid, username, encrypted_cookies, created_at) VALUES (?, ?, ?, ?)",
        (sid, username, encrypted, created_at),
    )
    conn.commit()


def delete_session_row(sid: str) -> None:
    conn = _connect()
    conn.execute("DELETE FROM sessions WHERE sid = ?", (sid,))
    conn.commit()


def purge_expired_sessions(cutoff: float) -> None:
    conn = _connect()
    conn.execute("DELETE FROM sessions WHERE created_at < ?", (cutoff,))
    conn.commit()


def load_sessions() -> list[tuple[str, str, dict[str, str], float]]:
    """Recharge les sessions persistées ; ignore silencieusement celles illisibles
    (clé secrète tournée entre-temps, corruption)."""
    conn = _connect()
    rows = conn.execute("SELECT sid, username, encrypted_cookies, created_at FROM sessions").fetchall()
    fernet = _get_fernet()
    restored = []
    for sid, username, encrypted_cookies, created_at in rows:
        try:
            cookies = json.loads(fernet.decrypt(encrypted_cookies.encode()).decode())
        except (InvalidToken, ValueError):
            conn.execute("DELETE FROM sessions WHERE sid = ?", (sid,))
            conn.commit()
            continue
        restored.append((sid, username, cookies, created_at))
    return restored


# ── Session ScoDoc réutilisée par le polling push ───────────────────────────
# Évite de refaire un login CAS complet (3 sauts réseau, avec le mot de passe) à
# chaque cycle de polling : un login CAS répété toutes les 10 min par abonné,
# depuis la seule IP du serveur, ressemble à du bourrage d'identifiants côté CAS.

def save_push_session(username: str, cookies: dict[str, str]) -> None:
    encrypted = _get_fernet().encrypt(json.dumps(cookies).encode()).decode()
    conn = _connect()
    conn.execute(
        "INSERT OR REPLACE INTO push_sessions (username, encrypted_cookies, updated_at) VALUES (?, ?, ?)",
        (username, encrypted, time.time()),
    )
    conn.commit()


def get_push_session(username: str) -> dict[str, str] | None:
    conn = _connect()
    row = conn.execute(
        "SELECT encrypted_cookies FROM push_sessions WHERE username = ?", (username,)
    ).fetchone()
    if not row:
        return None
    try:
        return json.loads(_get_fernet().decrypt(row[0].encode()).decode())
    except (InvalidToken, ValueError):
        conn.execute("DELETE FROM push_sessions WHERE username = ?", (username,))
        conn.commit()
        return None


def delete_push_session(username: str) -> None:
    conn = _connect()
    conn.execute("DELETE FROM push_sessions WHERE username = ?", (username,))
    conn.commit()


def purge_orphaned_push_sessions() -> int:
    """Nettoie les sessions push d'utilisateurs qui ne sont plus abonnés à aucune notification."""
    conn = _connect()
    rows = conn.execute(
        "SELECT username FROM push_sessions WHERE username NOT IN (SELECT DISTINCT username FROM push_subscriptions)"
    ).fetchall()
    if rows:
        conn.execute(
            "DELETE FROM push_sessions WHERE username NOT IN (SELECT DISTINCT username FROM push_subscriptions)"
        )
        conn.commit()
    return len(rows)
