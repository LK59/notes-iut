"""Dérivation des clés de chiffrement (mot de passe maître, tokens remember-me)."""
from __future__ import annotations

import base64
import hashlib
import os
import time

from cryptography.fernet import Fernet

from .db import DB_PATH

REMEMBER_KEY_ROTATION_SECONDS = 7 * 24 * 3600


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


def encryption_key_source() -> str:
    return "SECRET_KEY" if os.environ.get("SECRET_KEY") else "data/secret.key"
