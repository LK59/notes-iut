"""Cache des semestres et relevés scrapés depuis ScoDoc."""
from __future__ import annotations

import json
import sqlite3
import time

from ..scodoc_payloads import validate_premiere_connexion_payload, validate_releve_payload
from .db import _connect

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
