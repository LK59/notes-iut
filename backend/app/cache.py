"""Cache SQLite des relevés scrapés, tokens de reconnexion et clé secrète."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets as secrets_module
import sqlite3
import time
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.fernet import InvalidToken

from .errors import RememberTokenDecryptError
from .scodoc_payloads import validate_premiere_connexion_payload, validate_releve_payload

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "cache.db"
REMEMBER_KEY_ROTATION_SECONDS = 7 * 24 * 3600
REMEMBER_IDLE_TTL = 7 * 24 * 3600
MAX_REMEMBER_TOKENS_PER_USER = 6

# ── Clé secrète ──────────────────────────────────────────────────────────────

def _master_secret_bytes() -> bytes:
    secret = os.environ.get("SECRET_KEY")
    if secret:
        return secret.encode()
    key_path = DB_PATH.parent / "secret.key"
    key_path.parent.mkdir(parents=True, exist_ok=True)
    if key_path.exists():
        return key_path.read_bytes()
    key = Fernet.generate_key()
    key_path.write_bytes(key)
    return key


def _fernet_from_material(material: bytes) -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(material).digest())
    return Fernet(key)


def _get_fernet() -> Fernet:
    return _fernet_from_material(_master_secret_bytes())


def _current_key_id(now: float | None = None) -> str:
    return str(int((now or time.time()) // REMEMBER_KEY_ROTATION_SECONDS))


def _remember_fernet(key_id: str) -> Fernet:
    return _fernet_from_material(_master_secret_bytes() + f":remember:{key_id}".encode())


def _candidate_remember_fernets(key_id: str | None) -> list[tuple[str, Fernet]]:
    current = int(_current_key_id())
    ids: list[str] = []
    if key_id:
        ids.append(str(key_id))
    ids.extend(str(i) for i in range(current, current - 6, -1))
    unique_ids = list(dict.fromkeys(ids))
    return [(kid, _remember_fernet(kid)) for kid in unique_ids]


def _hash_metadata(value: str | None) -> str | None:
    if not value:
        return None
    salt = hashlib.sha256(_master_secret_bytes()).hexdigest()
    return hashlib.sha256(f"{salt}:{value}".encode()).hexdigest()


# ── Connexion SQLite ──────────────────────────────────────────────────────────

def _ensure_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    for name, definition in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS releves (
            username TEXT NOT NULL,
            semestre_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            updated_at REAL NOT NULL,
            PRIMARY KEY (username, semestre_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS semestres (
            username TEXT NOT NULL PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at REAL NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS remember_tokens (
            token_hash TEXT NOT NULL PRIMARY KEY,
            username TEXT NOT NULL,
            encrypted_password TEXT NOT NULL,
            expires_at REAL NOT NULL
        )
        """
    )
    _ensure_columns(
        conn,
        "remember_tokens",
        {
            "created_at": "REAL",
            "last_used_at": "REAL",
            "key_id": "TEXT",
            "user_agent": "TEXT",
            "ip_hash": "TEXT",
            "session_id": "TEXT",
        },
    )
    rows_without_session = conn.execute(
        "SELECT token_hash FROM remember_tokens WHERE session_id IS NULL OR session_id = ''"
    ).fetchall()
    for (token_hash,) in rows_without_session:
        conn.execute(
            "UPDATE remember_tokens SET session_id = ? WHERE token_hash = ?",
            (secrets_module.token_urlsafe(16), token_hash),
        )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS remember_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            token_hash_prefix TEXT NOT NULL,
            event TEXT NOT NULL,
            created_at REAL NOT NULL,
            user_agent TEXT,
            ip_hash TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_cache_meta (
            username TEXT NOT NULL PRIMARY KEY,
            current_semestre_id TEXT,
            updated_at REAL NOT NULL
        )
        """
    )
    return conn


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


# ── Semestres ─────────────────────────────────────────────────────────────────

SEMESTRES_TTL = 3600  # 1 h
RELEVE_CURRENT_TTL = 900  # 15 min pour le semestre courant
RELEVE_ARCHIVED_TTL = 24 * 3600  # 24 h pour les semestres passes

def get_semestres(username: str) -> dict | None:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT payload, updated_at FROM semestres WHERE username = ?",
            (username,),
        ).fetchone()
        if not row:
            return None
        if time.time() - row[1] > SEMESTRES_TTL:
            return None
        payload = json.loads(row[0])
        try:
            return validate_premiere_connexion_payload(payload)
        except Exception:
            conn.execute("DELETE FROM semestres WHERE username = ?", (username,))
            conn.commit()
            return None
    finally:
        conn.close()


def set_semestres(username: str, payload: dict) -> None:
    payload = validate_premiere_connexion_payload(payload)
    current_semestre_id = None
    semestres = payload.get("semestres", [])
    if semestres:
        last = semestres[-1]
        if isinstance(last, dict):
            current_semestre_id = last.get("formsemestre_id")
    conn = _connect()
    try:
        conn.execute(
            """
            INSERT INTO semestres (username, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT (username)
            DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
            """,
            (username, json.dumps(payload), time.time()),
        )
        conn.execute(
            """
            INSERT INTO user_cache_meta (username, current_semestre_id, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT (username)
            DO UPDATE SET current_semestre_id = excluded.current_semestre_id, updated_at = excluded.updated_at
            """,
            (username, str(current_semestre_id) if current_semestre_id else None, time.time()),
        )
        conn.commit()
    finally:
        conn.close()


def delete_semestres(username: str) -> None:
    conn = _connect()
    try:
        conn.execute("DELETE FROM semestres WHERE username = ?", (username,))
        conn.commit()
    finally:
        conn.close()


# ── Relevés ───────────────────────────────────────────────────────────────────

def _releve_ttl(conn: sqlite3.Connection, username: str, semestre_id: str) -> int:
    row = conn.execute(
        "SELECT current_semestre_id FROM user_cache_meta WHERE username = ?",
        (username,),
    ).fetchone()
    if row and row[0] and str(row[0]) != str(semestre_id):
        return RELEVE_ARCHIVED_TTL
    return RELEVE_CURRENT_TTL

def get_releve(username: str, semestre_id: str) -> dict | None:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT payload, updated_at FROM releves WHERE username = ? AND semestre_id = ?",
            (username, semestre_id),
        ).fetchone()
        if not row:
            return None
        if time.time() - row[1] > _releve_ttl(conn, username, semestre_id):
            return None
        payload = json.loads(row[0])
        try:
            return validate_releve_payload(payload)
        except Exception:
            conn.execute(
                "DELETE FROM releves WHERE username = ? AND semestre_id = ?",
                (username, semestre_id),
            )
            conn.commit()
            return None
    finally:
        conn.close()


def set_releve(username: str, semestre_id: str, payload: dict) -> None:
    payload = validate_releve_payload(payload)
    conn = _connect()
    try:
        conn.execute(
            """
            INSERT INTO releves (username, semestre_id, payload, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (username, semestre_id)
            DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
            """,
            (username, semestre_id, json.dumps(payload), time.time()),
        )
        conn.commit()
    finally:
        conn.close()


def delete_releves(username: str) -> None:
    conn = _connect()
    try:
        conn.execute("DELETE FROM releves WHERE username = ?", (username,))
        conn.commit()
    finally:
        conn.close()


def delete_user_cache(username: str) -> None:
    delete_semestres(username)
    delete_releves(username)
    conn = _connect()
    try:
        conn.execute("DELETE FROM user_cache_meta WHERE username = ?", (username,))
        conn.commit()
    finally:
        conn.close()


# ── Tokens de reconnexion ─────────────────────────────────────────────────────

REMEMBER_TOKEN_TTL = 30 * 24 * 3600  # 30 jours


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_remember_token(username: str, password: str, user_agent: str | None = None, ip_address: str | None = None) -> str:
    """Chiffre le mot de passe, persiste le token haché, retourne le token brut."""
    token = secrets_module.token_urlsafe(32)
    token_hash = _hash_token(token)
    session_id = secrets_module.token_urlsafe(16)
    now = time.time()
    key_id = _current_key_id(now)
    encrypted = _remember_fernet(key_id).encrypt(password.encode()).decode()
    expires_at = time.time() + REMEMBER_TOKEN_TTL
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
    finally:
        conn.close()
    return token


def get_remember_credentials(token: str, user_agent: str | None = None, ip_address: str | None = None) -> tuple[str, str] | None:
    """Valide le token et retourne (username, mot_de_passe_clair), ou None si invalide/expiré."""
    token_hash = _hash_token(token)
    conn = _connect()
    try:
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
            _log_remember_event(conn, username, token_hash, "expired", user_agent, ip_address)
            conn.execute("DELETE FROM remember_tokens WHERE token_hash = ?", (token_hash,))
            conn.commit()
            return None
        last_seen = last_used_at or created_at or now
        if now - last_seen > REMEMBER_IDLE_TTL:
            _log_remember_event(conn, username, token_hash, "idle_expired", user_agent, ip_address)
            conn.execute("DELETE FROM remember_tokens WHERE token_hash = ?", (token_hash,))
            conn.commit()
            return None

        decrypt_error: InvalidToken | None = None
        for candidate_key_id, fernet in _candidate_remember_fernets(key_id):
            try:
                password = fernet.decrypt(encrypted_password.encode()).decode()
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
                return (username, password)
            except InvalidToken as exc:
                decrypt_error = exc

        try:
            password = _get_fernet().decrypt(encrypted_password.encode()).decode()
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
            return (username, password)
        except InvalidToken as exc:
            decrypt_error = decrypt_error or exc
            _log_remember_event(conn, username, token_hash, "decrypt_failed", user_agent, ip_address)
            conn.execute("DELETE FROM remember_tokens WHERE token_hash = ?", (token_hash,))
            conn.commit()
            raise RememberTokenDecryptError() from decrypt_error
    finally:
        conn.close()


def delete_remember_token(token: str, user_agent: str | None = None, ip_address: str | None = None) -> None:
    conn = _connect()
    try:
        token_hash = _hash_token(token)
        row = conn.execute("SELECT username FROM remember_tokens WHERE token_hash = ?", (token_hash,)).fetchone()
        if row:
            _log_remember_event(conn, row[0], token_hash, "deleted", user_agent, ip_address)
        conn.execute("DELETE FROM remember_tokens WHERE token_hash = ?", (token_hash,))
        conn.commit()
    finally:
        conn.close()


def list_remember_sessions(username: str) -> list[dict]:
    conn = _connect()
    try:
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
    finally:
        conn.close()


def delete_remember_session(username: str, session_id: str, user_agent: str | None = None, ip_address: str | None = None) -> bool:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT token_hash FROM remember_tokens WHERE username = ? AND session_id = ?",
            (username, session_id),
        ).fetchone()
        if not row:
            return False
        token_hash = row[0]
        _log_remember_event(conn, username, token_hash, "revoked", user_agent, ip_address)
        conn.execute("DELETE FROM remember_tokens WHERE username = ? AND session_id = ?", (username, session_id))
        conn.commit()
        return True
    finally:
        conn.close()


def delete_all_remember_sessions(username: str, user_agent: str | None = None, ip_address: str | None = None) -> int:
    conn = _connect()
    try:
        rows = conn.execute("SELECT token_hash FROM remember_tokens WHERE username = ?", (username,)).fetchall()
        for (token_hash,) in rows:
            _log_remember_event(conn, username, token_hash, "revoked_all", user_agent, ip_address)
        conn.execute("DELETE FROM remember_tokens WHERE username = ?", (username,))
        conn.commit()
        return len(rows)
    finally:
        conn.close()


def list_all_remember_sessions(limit: int = 200) -> list[dict]:
    conn = _connect()
    try:
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
    finally:
        conn.close()


def list_remember_events(limit: int = 200) -> list[dict]:
    conn = _connect()
    try:
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
    finally:
        conn.close()


def purge_expired_remember_tokens() -> None:
    conn = _connect()
    try:
        conn.execute("DELETE FROM remember_tokens WHERE expires_at < ?", (time.time(),))
        conn.commit()
    finally:
        conn.close()


def check_database() -> bool:
    conn = _connect()
    try:
        conn.execute("SELECT 1").fetchone()
        return True
    finally:
        conn.close()


def encryption_key_source() -> str:
    return "SECRET_KEY" if os.environ.get("SECRET_KEY") else "data/secret.key"


def remember_token_stats(username: str | None = None) -> dict:
    conn = _connect()
    try:
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
    finally:
        conn.close()


def cache_stats() -> dict:
    conn = _connect()
    try:
        semestres = conn.execute("SELECT COUNT(*) FROM semestres").fetchone()[0]
        releves = conn.execute("SELECT COUNT(*) FROM releves").fetchone()[0]
        users = conn.execute("SELECT COUNT(DISTINCT username) FROM user_cache_meta").fetchone()[0]
        return {
            "semestres_entries": semestres,
            "releve_entries": releves,
            "users_with_cache": users,
            "semestres_ttl_seconds": SEMESTRES_TTL,
            "releve_current_ttl_seconds": RELEVE_CURRENT_TTL,
            "releve_archived_ttl_seconds": RELEVE_ARCHIVED_TTL,
        }
    finally:
        conn.close()
