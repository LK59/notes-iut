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

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "cache.db"

# ── Clé secrète ──────────────────────────────────────────────────────────────

def _get_fernet() -> Fernet:
    secret = os.environ.get("SECRET_KEY")
    if secret:
        key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    else:
        key_path = DB_PATH.parent / "secret.key"
        key_path.parent.mkdir(parents=True, exist_ok=True)
        if key_path.exists():
            key = key_path.read_bytes()
        else:
            key = Fernet.generate_key()
            key_path.write_bytes(key)
    return Fernet(key)


# ── Connexion SQLite ──────────────────────────────────────────────────────────

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
    return conn


# ── Semestres ─────────────────────────────────────────────────────────────────

SEMESTRES_TTL = 3600  # 1 h

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
        return json.loads(row[0])
    finally:
        conn.close()


def set_semestres(username: str, payload: dict) -> None:
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
        conn.commit()
    finally:
        conn.close()


# ── Relevés ───────────────────────────────────────────────────────────────────

RELEVE_TTL = 900  # 15 min : balance entre fraîcheur et pression sur ScoDoc

def get_releve(username: str, semestre_id: str) -> dict | None:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT payload, updated_at FROM releves WHERE username = ? AND semestre_id = ?",
            (username, semestre_id),
        ).fetchone()
        if not row:
            return None
        if time.time() - row[1] > RELEVE_TTL:
            return None
        return json.loads(row[0])
    finally:
        conn.close()


def set_releve(username: str, semestre_id: str, payload: dict) -> None:
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


# ── Tokens de reconnexion ─────────────────────────────────────────────────────

REMEMBER_TOKEN_TTL = 30 * 24 * 3600  # 30 jours


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_remember_token(username: str, password: str) -> str:
    """Chiffre le mot de passe, persiste le token haché, retourne le token brut."""
    token = secrets_module.token_urlsafe(32)
    token_hash = _hash_token(token)
    encrypted = _get_fernet().encrypt(password.encode()).decode()
    expires_at = time.time() + REMEMBER_TOKEN_TTL
    conn = _connect()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO remember_tokens (token_hash, username, encrypted_password, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (token_hash, username, encrypted, expires_at),
        )
        conn.commit()
    finally:
        conn.close()
    return token


def get_remember_credentials(token: str) -> tuple[str, str] | None:
    """Valide le token et retourne (username, mot_de_passe_clair), ou None si invalide/expiré."""
    token_hash = _hash_token(token)
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT username, encrypted_password, expires_at FROM remember_tokens WHERE token_hash = ?",
            (token_hash,),
        ).fetchone()
        if not row:
            return None
        if time.time() > row[2]:
            conn.execute("DELETE FROM remember_tokens WHERE token_hash = ?", (token_hash,))
            conn.commit()
            return None
        password = _get_fernet().decrypt(row[1].encode()).decode()
        return (row[0], password)
    finally:
        conn.close()


def delete_remember_token(token: str) -> None:
    conn = _connect()
    try:
        conn.execute(
            "DELETE FROM remember_tokens WHERE token_hash = ?", (_hash_token(token),)
        )
        conn.commit()
    finally:
        conn.close()


def purge_expired_remember_tokens() -> None:
    conn = _connect()
    try:
        conn.execute("DELETE FROM remember_tokens WHERE expires_at < ?", (time.time(),))
        conn.commit()
    finally:
        conn.close()
