"""Cache SQLite des relevés scrapés, pour éviter de re-solliciter le CAS à chaque clic."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "cache.db"


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
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
    return conn


def get_releve(username: str, semestre_id: str) -> dict | None:
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT payload FROM releves WHERE username = ? AND semestre_id = ?",
            (username, semestre_id),
        ).fetchone()
        return json.loads(row[0]) if row else None
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
