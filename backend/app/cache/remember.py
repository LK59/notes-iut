"""Tokens de reconnexion ("se souvenir de moi") : création, validation, révocation, audit."""
from __future__ import annotations

import hashlib
import secrets as secrets_module
import sqlite3
import time

from ..errors import RememberTokenDecryptError
from cryptography.fernet import InvalidToken

from .db import _connect
from .secrets import (
    REMEMBER_KEY_ROTATION_SECONDS,
    _candidate_remember_fernets,
    _current_key_id,
    _get_fernet,
    _hash_metadata,
    _remember_fernet,
)

REMEMBER_TOKEN_TTL = 30 * 24 * 3600  # 30 jours
REMEMBER_IDLE_TTL = 7 * 24 * 3600
MAX_REMEMBER_TOKENS_PER_USER = 6
REMEMBER_EVENTS_RETENTION_SECONDS = 90 * 24 * 3600


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _log_remember_event(
    conn: sqlite3.Connection,
    username: str,
    token_hash: str,
    event: str,
    user_agent: str | None = None,
    ip_address: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO remember_events (username, token_hash_prefix, event, created_at, user_agent, ip_hash)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (username, token_hash[:12], event, time.time(), user_agent, _hash_metadata(ip_address)),
    )


def create_remember_token(username: str, password: str, user_agent: str | None = None, ip_address: str | None = None) -> str:
    """Chiffre le mot de passe, persiste le token haché, retourne le token brut."""
    token = secrets_module.token_urlsafe(32)
    token_hash = _hash_token(token)
    session_id = secrets_module.token_urlsafe(16)
    now = time.time()
    key_id = _current_key_id(now)
    encrypted = _remember_fernet(key_id).encrypt(password.encode()).decode()
    expires_at = now + REMEMBER_TOKEN_TTL
    conn = _connect()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO remember_tokens (
                token_hash, username, encrypted_password, expires_at, created_at, last_used_at,
                key_id, user_agent, ip_hash, session_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                token_hash,
                username,
                encrypted,
                expires_at,
                now,
                now,
                key_id,
                user_agent,
                _hash_metadata(ip_address),
                session_id,
            ),
        )
        stale_rows = conn.execute(
            """
            SELECT token_hash FROM remember_tokens
            WHERE username = ?
            ORDER BY COALESCE(last_used_at, created_at, 0) DESC
            LIMIT -1 OFFSET ?
            """,
            (username, MAX_REMEMBER_TOKENS_PER_USER),
        ).fetchall()
        for (old_hash,) in stale_rows:
            _log_remember_event(conn, username, old_hash, "evicted", user_agent, ip_address)
            conn.execute("DELETE FROM remember_tokens WHERE token_hash = ?", (old_hash,))
        _log_remember_event(conn, username, token_hash, "created", user_agent, ip_address)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return token


def get_remember_credentials(token: str, user_agent: str | None = None, ip_address: str | None = None) -> tuple[str, str] | None:
    """Valide le token et retourne (username, mot_de_passe_clair), ou None si invalide/expiré."""
    token_hash = _hash_token(token)
    conn = _connect()
    row = conn.execute(
        """
        SELECT username, encrypted_password, expires_at, created_at, last_used_at, key_id
        FROM remember_tokens
        WHERE token_hash = ?
        """,
        (token_hash,),
    ).fetchone()
    if not row:
        return None
    now = time.time()
    username, encrypted_password, expires_at, created_at, last_used_at, key_id = row
    if now > expires_at:
        try:
            _log_remember_event(conn, username, token_hash, "expired", user_agent, ip_address)
            conn.execute("DELETE FROM remember_tokens WHERE token_hash = ?", (token_hash,))
            conn.commit()
        except Exception:
            conn.rollback()
        return None
    last_seen = last_used_at or created_at or now
    if now - last_seen > REMEMBER_IDLE_TTL:
        try:
            _log_remember_event(conn, username, token_hash, "idle_expired", user_agent, ip_address)
            conn.execute("DELETE FROM remember_tokens WHERE token_hash = ?", (token_hash,))
            conn.commit()
        except Exception:
            conn.rollback()
        return None

    decrypt_error: InvalidToken | None = None
    for candidate_key_id, fernet in _candidate_remember_fernets(key_id):
        try:
            password = fernet.decrypt(encrypted_password.encode()).decode()
            try:
                conn.execute(
                    """
                    UPDATE remember_tokens
                    SET last_used_at = ?, key_id = ?, user_agent = COALESCE(?, user_agent), ip_hash = COALESCE(?, ip_hash)
                    WHERE token_hash = ?
                    """,
                    (now, candidate_key_id, user_agent, _hash_metadata(ip_address), token_hash),
                )
                _log_remember_event(conn, username, token_hash, "used", user_agent, ip_address)
                conn.commit()
            except Exception:
                conn.rollback()
            return (username, password)
        except InvalidToken as exc:
            decrypt_error = exc

    try:
        password = _get_fernet().decrypt(encrypted_password.encode()).decode()
        try:
            conn.execute(
                """
                UPDATE remember_tokens
                SET last_used_at = ?, key_id = ?, user_agent = COALESCE(?, user_agent), ip_hash = COALESCE(?, ip_hash)
                WHERE token_hash = ?
                """,
                (now, _current_key_id(now), user_agent, _hash_metadata(ip_address), token_hash),
            )
            _log_remember_event(conn, username, token_hash, "legacy_used", user_agent, ip_address)
            conn.commit()
        except Exception:
            conn.rollback()
        return (username, password)
    except InvalidToken as exc:
        decrypt_error = decrypt_error or exc
        try:
            _log_remember_event(conn, username, token_hash, "decrypt_failed", user_agent, ip_address)
            conn.execute("DELETE FROM remember_tokens WHERE token_hash = ?", (token_hash,))
            conn.commit()
        except Exception:
            conn.rollback()
        raise RememberTokenDecryptError() from decrypt_error


def delete_remember_token(token: str, user_agent: str | None = None, ip_address: str | None = None) -> None:
    conn = _connect()
    token_hash = _hash_token(token)
    row = conn.execute("SELECT username FROM remember_tokens WHERE token_hash = ?", (token_hash,)).fetchone()
    try:
        if row:
            _log_remember_event(conn, row[0], token_hash, "deleted", user_agent, ip_address)
        conn.execute("DELETE FROM remember_tokens WHERE token_hash = ?", (token_hash,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def list_remember_sessions(username: str) -> list[dict]:
    conn = _connect()
    rows = conn.execute(
        """
        SELECT session_id, username, created_at, last_used_at, expires_at, user_agent
        FROM remember_tokens
        WHERE username = ?
        ORDER BY COALESCE(last_used_at, created_at, 0) DESC
        """,
        (username,),
    ).fetchall()
    return [
        {
            "session_id": row[0],
            "username": row[1],
            "created_at": row[2],
            "last_used_at": row[3],
            "expires_at": row[4],
            "user_agent": row[5],
        }
        for row in rows
    ]


def delete_remember_session(username: str, session_id: str, user_agent: str | None = None, ip_address: str | None = None) -> bool:
    conn = _connect()
    row = conn.execute(
        "SELECT token_hash FROM remember_tokens WHERE username = ? AND session_id = ?",
        (username, session_id),
    ).fetchone()
    if not row:
        return False
    token_hash = row[0]
    try:
        _log_remember_event(conn, username, token_hash, "revoked", user_agent, ip_address)
        conn.execute("DELETE FROM remember_tokens WHERE username = ? AND session_id = ?", (username, session_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return True


def delete_all_remember_sessions(username: str, user_agent: str | None = None, ip_address: str | None = None) -> int:
    conn = _connect()
    rows = conn.execute("SELECT token_hash FROM remember_tokens WHERE username = ?", (username,)).fetchall()
    try:
        for (token_hash,) in rows:
            _log_remember_event(conn, username, token_hash, "revoked_all", user_agent, ip_address)
        conn.execute("DELETE FROM remember_tokens WHERE username = ?", (username,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return len(rows)


def list_all_remember_sessions(limit: int = 200) -> list[dict]:
    conn = _connect()
    rows = conn.execute(
        """
        SELECT session_id, username, created_at, last_used_at, expires_at, user_agent
        FROM remember_tokens
        ORDER BY COALESCE(last_used_at, created_at, 0) DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [
        {
            "session_id": row[0],
            "username": row[1],
            "created_at": row[2],
            "last_used_at": row[3],
            "expires_at": row[4],
            "user_agent": row[5],
        }
        for row in rows
    ]


def list_remember_events(limit: int = 200) -> list[dict]:
    conn = _connect()
    rows = conn.execute(
        """
        SELECT id, username, token_hash_prefix, event, created_at, user_agent, ip_hash
        FROM remember_events
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [
        {
            "id": row[0],
            "username": row[1],
            "token_hash_prefix": row[2],
            "event": row[3],
            "created_at": row[4],
            "user_agent": row[5],
            "ip_hash": row[6],
        }
        for row in rows
    ]


def purge_expired_remember_tokens() -> None:
    conn = _connect()
    try:
        conn.execute("DELETE FROM remember_tokens WHERE expires_at < ?", (time.time(),))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def purge_old_remember_events(retention_seconds: int = REMEMBER_EVENTS_RETENTION_SECONDS) -> None:
    conn = _connect()
    try:
        conn.execute(
            "DELETE FROM remember_events WHERE created_at < ?",
            (time.time() - retention_seconds,),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def remember_token_stats(username: str | None = None) -> dict:
    conn = _connect()
    if username:
        active = conn.execute(
            "SELECT COUNT(*) FROM remember_tokens WHERE username = ?",
            (username,),
        ).fetchone()[0]
        events = conn.execute(
            "SELECT COUNT(*) FROM remember_events WHERE username = ?",
            (username,),
        ).fetchone()[0]
    else:
        active = conn.execute("SELECT COUNT(*) FROM remember_tokens").fetchone()[0]
        events = conn.execute("SELECT COUNT(*) FROM remember_events").fetchone()[0]
    return {
        "active_tokens": active,
        "events": events,
        "max_tokens_per_user": MAX_REMEMBER_TOKENS_PER_USER,
        "idle_ttl_seconds": REMEMBER_IDLE_TTL,
        "absolute_ttl_seconds": REMEMBER_TOKEN_TTL,
        "key_rotation_seconds": REMEMBER_KEY_ROTATION_SECONDS,
        "current_key_id": _current_key_id(),
    }


def get_credentials_for_background(username: str) -> tuple[str, str] | None:
    """Récupère les credentials depuis le token remember-me le plus récent, pour le polling push."""
    conn = _connect()
    row = conn.execute(
        """
        SELECT encrypted_password, key_id
        FROM remember_tokens
        WHERE username = ? AND expires_at > ?
        ORDER BY COALESCE(last_used_at, created_at, 0) DESC
        LIMIT 1
        """,
        (username, time.time()),
    ).fetchone()
    if not row:
        return None
    encrypted_password, key_id = row
    for _, fernet in _candidate_remember_fernets(key_id):
        try:
            password = fernet.decrypt(encrypted_password.encode()).decode()
            return (username, password)
        except InvalidToken:
            pass
    try:
        password = _get_fernet().decrypt(encrypted_password.encode()).decode()
        return (username, password)
    except InvalidToken:
        return None


def get_background_token_deadlines(username: str) -> dict | None:
    """Échéances du remember-token utilisé pour le polling en tâche de fond (le plus
    récemment actif) : au-delà, get_credentials_for_background ne trouvera plus rien et
    la reconnexion automatique/le polling push s'arrêteront silencieusement."""
    conn = _connect()
    row = conn.execute(
        """
        SELECT token_hash, created_at, last_used_at, expires_at
        FROM remember_tokens
        WHERE username = ? AND expires_at > ?
        ORDER BY COALESCE(last_used_at, created_at, 0) DESC
        LIMIT 1
        """,
        (username, time.time()),
    ).fetchone()
    if not row:
        return None
    token_hash, created_at, last_used_at, expires_at = row
    last_seen = last_used_at or created_at or time.time()
    return {
        "token_hash": token_hash,
        "absolute_deadline": expires_at,
        "idle_deadline": last_seen + REMEMBER_IDLE_TTL,
    }


def get_reauth_warning_state(username: str) -> dict:
    conn = _connect()
    row = conn.execute(
        "SELECT idle_warning_token_hash, absolute_warning_token_hash FROM push_poll_state WHERE username = ?",
        (username,),
    ).fetchone()
    return {
        "idle_warning_token_hash": row[0] if row else None,
        "absolute_warning_token_hash": row[1] if row else None,
    }


def mark_reauth_warning_sent(username: str, field: str, token_hash: str) -> None:
    if field not in ("idle_warning_token_hash", "absolute_warning_token_hash"):
        raise ValueError(f"champ d'avertissement inconnu : {field}")
    conn = _connect()
    conn.execute(
        f"""
        INSERT INTO push_poll_state (username, {field})
        VALUES (?, ?)
        ON CONFLICT(username) DO UPDATE SET {field} = excluded.{field}
        """,
        (username, token_hash),
    )
    conn.commit()
