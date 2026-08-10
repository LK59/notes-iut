"""Connexion SQLite persistante par thread et schéma de la base de cache."""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent.parent.parent / "data" / "cache.db"
VAPID_KEYS_PATH = DB_PATH.parent / "vapid.keys"

# Chaque thread du pool uvicorn/starlette réutilise sa propre connexion plutôt
# que d'ouvrir/fermer à chaque opération. Le schéma n'est initialisé qu'une
# seule fois par processus (derrière un verrou), les tables existantes sont déjà
# visibles par les connexions suivantes (WAL mode, même fichier).
_db_schema_initialized = False
_schema_init_lock = threading.Lock()
_thread_local = threading.local()


def _ensure_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    for name, definition in columns.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


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
        import secrets as secrets_module

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
    _ensure_columns(
        conn,
        "push_poll_state",
        {"idle_warning_token_hash": "TEXT", "absolute_warning_token_hash": "TEXT"},
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
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS push_sessions (
            username TEXT NOT NULL PRIMARY KEY,
            encrypted_cookies TEXT NOT NULL,
            updated_at REAL NOT NULL
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


def check_database() -> bool:
    conn = _connect()
    conn.execute("SELECT 1").fetchone()
    return True
