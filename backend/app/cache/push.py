"""Souscriptions push, état du polling en tâche de fond, snapshots de notes."""
from __future__ import annotations

import json
import time

from .db import _connect
from .vapid import get_or_create_vapid_keys

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
