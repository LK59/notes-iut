"""Cache SQLite des relevés scrapés, tokens de reconnexion et clé secrète."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets as secrets_module
import sqlite3
import threading
import time
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.fernet import InvalidToken

from .errors import RememberTokenDecryptError
from .scodoc_payloads import validate_premiere_connexion_payload, validate_releve_payload

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "cache.db"
VAPID_KEYS_PATH = DB_PATH.parent / "vapid.keys"
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


# ── Connexion SQLite persistante par thread ──────────────────────────────────
# Chaque thread du pool uvicorn/starlette réutilise sa propre connexion plutôt
# que d'ouvrir/fermer à chaque opération. Le schéma n'est initialisé qu'une
# seule fois par processus (derrière un verrou), les tables existantes sont déjà
# visibles par les connexions suivantes (WAL mode, même fichier).

def _ensure_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    for name, definition in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


_db_schema_initialized = False
_schema_init_lock = threading.Lock()
_thread_local = threading.local()


def _init_schema(conn: sqlite3.Connection) -> None:
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
    if rows_without_session:
        for (token_hash,) in rows_without_session:
            conn.execute(
                "UPDATE remember_tokens SET session_id = ? WHERE token_hash = ?",
                (secrets_module.token_urlsafe(16), token_hash),
            )
        conn.commit()
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            endpoint TEXT NOT NULL PRIMARY KEY,
            username TEXT NOT NULL,
            p256dh_key TEXT NOT NULL,
            auth_key TEXT NOT NULL,
            vapid_public_key TEXT,
            include_grade_value INTEGER NOT NULL DEFAULT 0,
            created_at REAL NOT NULL
        )
        """
    )
    _ensure_columns(conn, "push_subscriptions", {"vapid_public_key": "TEXT", "include_grade_value": "INTEGER NOT NULL DEFAULT 0"})
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS grade_snapshots (
            username TEXT NOT NULL,
            semestre_id TEXT NOT NULL,
            snapshot_json TEXT NOT NULL,
            updated_at REAL NOT NULL,
            PRIMARY KEY (username, semestre_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS push_poll_state (
            username TEXT NOT NULL PRIMARY KEY,
            last_started_at REAL,
            last_success_at REAL,
            last_error_at REAL,
            last_error TEXT,
            next_retry_at REAL,
            failure_count INTEGER NOT NULL DEFAULT 0,
            last_semestre_id TEXT,
            last_new_grades_count INTEGER NOT NULL DEFAULT 0,
            last_notification_at REAL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rate_limit (
            key TEXT NOT NULL PRIMARY KEY,
            timestamps TEXT NOT NULL DEFAULT '[]'
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT NOT NULL PRIMARY KEY,
            username TEXT NOT NULL,
            encrypted_cookies TEXT NOT NULL,
            created_at REAL NOT NULL
        )
        """
    )


def _connect() -> sqlite3.Connection:
    global _db_schema_initialized
    conn = getattr(_thread_local, "conn", None)
    if conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        _thread_local.conn = conn
        with _schema_init_lock:
            if not _db_schema_initialized:
                _init_schema(conn)
                _db_schema_initialized = True
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


# ── VAPID (clés pour les push notifications) ──────────────────────────────────

def get_or_create_vapid_keys() -> tuple[str, str]:
    """Retourne (private_key_b64url, public_key_b64url).

    private_key_b64url : entier P-256 brut (32 octets) encodé base64url sans padding.
    py_vapid.from_string() le décode → 32 octets → appelle from_raw() → ok.
    public_key_b64url  : point non-compressé X9.62 (65 octets) base64url, pour applicationServerKey.
    """
    priv_env = os.environ.get("VAPID_PRIVATE_KEY")
    pub_env = os.environ.get("VAPID_PUBLIC_KEY")
    if priv_env and pub_env:
        return priv_env, pub_env
    if VAPID_KEYS_PATH.exists():
        data = json.loads(VAPID_KEYS_PATH.read_text())
        priv = data.get("private", "")
        pub = data.get("public", "")
        # Format correct : chaîne base64url de 43 chars (32 octets)
        # Format incorrect : PEM (généré par erreur précédente) → supprimer et régénérer
        if pub and not priv.startswith("-----"):
            return priv, pub
        VAPID_KEYS_PATH.unlink(missing_ok=True)
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    priv_bytes = private_key.private_numbers().private_value.to_bytes(32, "big")
    pub_bytes = public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    priv_b64 = base64.urlsafe_b64encode(priv_bytes).rstrip(b"=").decode()
    pub_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode()
    VAPID_KEYS_PATH.parent.mkdir(parents=True, exist_ok=True)
    VAPID_KEYS_PATH.write_text(json.dumps({"private": priv_b64, "public": pub_b64}))
    return priv_b64, pub_b64


# ── Semestres ─────────────────────────────────────────────────────────────────

SEMESTRES_TTL = 3600  # 1 h
RELEVE_CURRENT_TTL = 900  # 15 min pour le semestre courant
RELEVE_ARCHIVED_TTL = 24 * 3600  # 24 h pour les semestres passes


def get_semestres(username: str) -> dict | None:
    conn = _connect()
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
        try:
            conn.execute("DELETE FROM semestres WHERE username = ?", (username,))
            conn.commit()
        except Exception:
            conn.rollback()
        return None


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
    except Exception:
        conn.rollback()
        raise


def delete_semestres(username: str) -> None:
    conn = _connect()
    try:
        conn.execute("DELETE FROM semestres WHERE username = ?", (username,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


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
        try:
            conn.execute(
                "DELETE FROM releves WHERE username = ? AND semestre_id = ?",
                (username, semestre_id),
            )
            conn.commit()
        except Exception:
            conn.rollback()
        return None


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
    except Exception:
        conn.rollback()
        raise


def delete_releves(username: str) -> None:
    conn = _connect()
    try:
        conn.execute("DELETE FROM releves WHERE username = ?", (username,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def delete_user_cache(username: str) -> None:
    delete_semestres(username)
    delete_releves(username)
    conn = _connect()
    try:
        conn.execute("DELETE FROM user_cache_meta WHERE username = ?", (username,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


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


# ── Sessions serveur persistées ────────────────────────────────────────────
# Les cookies de session ScoDoc/CAS sont chiffrés comme un mot de passe : ils
# donnent un accès complet au compte tant que la session CAS distante est valide.

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


def check_database() -> bool:
    conn = _connect()
    conn.execute("SELECT 1").fetchone()
    return True


def encryption_key_source() -> str:
    return "SECRET_KEY" if os.environ.get("SECRET_KEY") else "data/secret.key"


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


def cache_stats() -> dict:
    conn = _connect()
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


# ── Push subscriptions ────────────────────────────────────────────────────────

def upsert_push_subscription(username: str, endpoint: str, p256dh: str, auth: str, vapid_public_key: str, include_grade_value: bool) -> None:
    conn = _connect()
    try:
        conn.execute(
            """
            INSERT INTO push_subscriptions (endpoint, username, p256dh_key, auth_key, vapid_public_key, include_grade_value, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                username = excluded.username,
                p256dh_key = excluded.p256dh_key,
                auth_key = excluded.auth_key,
                vapid_public_key = excluded.vapid_public_key,
                include_grade_value = excluded.include_grade_value,
                created_at = excluded.created_at
            """,
            (endpoint, username, p256dh, auth, vapid_public_key, 1 if include_grade_value else 0, time.time()),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def delete_push_subscriptions(username: str) -> None:
    conn = _connect()
    try:
        conn.execute("DELETE FROM push_subscriptions WHERE username = ?", (username,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def delete_push_subscription_by_endpoint(endpoint: str) -> None:
    conn = _connect()
    try:
        conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def set_push_include_grade_value(username: str, include_grade_value: bool) -> None:
    conn = _connect()
    try:
        conn.execute(
            "UPDATE push_subscriptions SET include_grade_value = ? WHERE username = ?",
            (1 if include_grade_value else 0, username),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def get_push_preferences(username: str) -> dict:
    conn = _connect()
    row = conn.execute(
        """
        SELECT include_grade_value
        FROM push_subscriptions
        WHERE username = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (username,),
    ).fetchone()
    return {"include_grade_value": bool(row[0]) if row else False}


def get_push_subscriptions(username: str) -> list[dict]:
    conn = _connect()
    _, current_vapid_public_key = get_or_create_vapid_keys()
    try:
        conn.execute(
            """
            DELETE FROM push_subscriptions
            WHERE username = ?
              AND vapid_public_key IS NOT NULL
              AND vapid_public_key != ?
            """,
            (username, current_vapid_public_key),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    rows = conn.execute(
        """
        SELECT endpoint, p256dh_key, auth_key, include_grade_value
        FROM push_subscriptions
        WHERE username = ?
          AND (vapid_public_key IS NULL OR vapid_public_key = ?)
        """,
        (username, current_vapid_public_key),
    ).fetchall()
    return [{"endpoint": r[0], "p256dh": r[1], "auth": r[2], "include_grade_value": bool(r[3])} for r in rows]


def list_subscribed_usernames() -> list[str]:
    conn = _connect()
    rows = conn.execute("SELECT DISTINCT username FROM push_subscriptions").fetchall()
    return [r[0] for r in rows]


# ── État du polling push ──────────────────────────────────────────────────────

def mark_push_poll_started(username: str) -> None:
    conn = _connect()
    try:
        conn.execute(
            """
            INSERT INTO push_poll_state (username, last_started_at)
            VALUES (?, ?)
            ON CONFLICT(username) DO UPDATE SET last_started_at = excluded.last_started_at
            """,
            (username, time.time()),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def mark_push_poll_success(username: str, semestre_id: str | None, new_grades_count: int, notified: bool) -> None:
    conn = _connect()
    now = time.time()
    try:
        conn.execute(
            """
            INSERT INTO push_poll_state (
                username, last_success_at, last_error, next_retry_at, failure_count,
                last_semestre_id, last_new_grades_count, last_notification_at
            )
            VALUES (?, ?, NULL, NULL, 0, ?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
                last_success_at = excluded.last_success_at,
                last_error = NULL,
                next_retry_at = NULL,
                failure_count = 0,
                last_semestre_id = excluded.last_semestre_id,
                last_new_grades_count = excluded.last_new_grades_count,
                last_notification_at = COALESCE(excluded.last_notification_at, push_poll_state.last_notification_at)
            """,
            (username, now, semestre_id, new_grades_count, now if notified else None),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def mark_push_poll_error(username: str, error: str, retry_delay_seconds: int) -> None:
    conn = _connect()
    now = time.time()
    try:
        conn.execute(
            """
            INSERT INTO push_poll_state (
                username, last_error_at, last_error, next_retry_at, failure_count
            )
            VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(username) DO UPDATE SET
                last_error_at = excluded.last_error_at,
                last_error = excluded.last_error,
                next_retry_at = excluded.next_retry_at,
                failure_count = push_poll_state.failure_count + 1
            """,
            (username, now, error[:500], now + retry_delay_seconds),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def get_push_poll_state(username: str) -> dict:
    conn = _connect()
    row = conn.execute(
        """
        SELECT last_started_at, last_success_at, last_error_at, last_error, next_retry_at,
               failure_count, last_semestre_id, last_new_grades_count, last_notification_at
        FROM push_poll_state
        WHERE username = ?
        """,
        (username,),
    ).fetchone()
    if not row:
        return {
            "last_started_at": None,
            "last_success_at": None,
            "last_error_at": None,
            "last_error": None,
            "next_retry_at": None,
            "failure_count": 0,
            "last_semestre_id": None,
            "last_new_grades_count": 0,
            "last_notification_at": None,
        }
    return {
        "last_started_at": row[0],
        "last_success_at": row[1],
        "last_error_at": row[2],
        "last_error": row[3],
        "next_retry_at": row[4],
        "failure_count": row[5],
        "last_semestre_id": row[6],
        "last_new_grades_count": row[7],
        "last_notification_at": row[8],
    }


def push_poll_stats(limit: int = 200) -> dict:
    conn = _connect()
    active_subscriptions = conn.execute("SELECT COUNT(*) FROM push_subscriptions").fetchone()[0]
    subscribed_users = conn.execute("SELECT COUNT(DISTINCT username) FROM push_subscriptions").fetchone()[0]
    snapshots = conn.execute("SELECT COUNT(*) FROM grade_snapshots").fetchone()[0]
    rows = conn.execute(
        """
        SELECT username, last_started_at, last_success_at, last_error_at, last_error,
               next_retry_at, failure_count, last_semestre_id, last_new_grades_count,
               last_notification_at
        FROM push_poll_state
        ORDER BY COALESCE(last_started_at, last_success_at, last_error_at, 0) DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return {
        "active_subscriptions": active_subscriptions,
        "subscribed_users": subscribed_users,
        "snapshots": snapshots,
        "users": [
            {
                "username": row[0],
                "last_started_at": row[1],
                "last_success_at": row[2],
                "last_error_at": row[3],
                "last_error": row[4],
                "next_retry_at": row[5],
                "failure_count": row[6],
                "last_semestre_id": row[7],
                "last_new_grades_count": row[8],
                "last_notification_at": row[9],
            }
            for row in rows
        ],
    }


# ── Snapshots de notes (pour le polling push) ─────────────────────────────────

def get_grade_snapshot(username: str, semestre_id: str) -> dict | None:
    conn = _connect()
    row = conn.execute(
        "SELECT snapshot_json FROM grade_snapshots WHERE username = ? AND semestre_id = ?",
        (username, semestre_id),
    ).fetchone()
    if not row:
        return None
    return json.loads(row[0])


def set_grade_snapshot(username: str, semestre_id: str, snapshot: dict) -> None:
    conn = _connect()
    try:
        conn.execute(
            """
            INSERT INTO grade_snapshots (username, semestre_id, snapshot_json, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (username, semestre_id)
            DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at
            """,
            (username, semestre_id, json.dumps(snapshot), time.time()),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise


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


# ── Rate limiting persisté en SQLite ─────────────────────────────────────────

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
