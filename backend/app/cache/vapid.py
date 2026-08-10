"""Clés VAPID (identité du serveur pour l'envoi de notifications push)."""
from __future__ import annotations

import base64
import json
import os

from . import db


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
    if db.VAPID_KEYS_PATH.exists():
        data = json.loads(db.VAPID_KEYS_PATH.read_text())
        priv = data.get("private", "")
        pub = data.get("public", "")
        # Format correct : chaîne base64url de 43 chars (32 octets)
        # Format incorrect : PEM (généré par erreur précédente) → supprimer et régénérer
        if pub and not priv.startswith("-----"):
            return priv, pub
        db.VAPID_KEYS_PATH.unlink(missing_ok=True)
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    priv_bytes = private_key.private_numbers().private_value.to_bytes(32, "big")
    pub_bytes = public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    priv_b64 = base64.urlsafe_b64encode(priv_bytes).rstrip(b"=").decode()
    pub_b64 = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode()
    db.VAPID_KEYS_PATH.parent.mkdir(parents=True, exist_ok=True)
    db.VAPID_KEYS_PATH.write_text(json.dumps({"private": priv_b64, "public": pub_b64}))
    return priv_b64, pub_b64
