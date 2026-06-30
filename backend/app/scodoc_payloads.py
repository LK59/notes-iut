from __future__ import annotations

from .errors import ScodocInvalidPayload, ScodocSessionRejected


def validate_premiere_connexion_payload(data: object) -> dict:
    if not isinstance(data, dict):
        raise ScodocInvalidPayload()

    redirect = data.get("redirect")
    if isinstance(redirect, str) and "doAuth.php" in redirect:
        raise ScodocSessionRejected()

    semestres = data.get("semestres")
    if not isinstance(semestres, list):
        raise ScodocInvalidPayload()

    return data


def validate_releve_payload(data: object) -> dict:
    if not isinstance(data, dict):
        raise ScodocInvalidPayload()

    redirect = data.get("redirect")
    if isinstance(redirect, str) and "doAuth.php" in redirect:
        raise ScodocSessionRejected()

    releve = data.get("relevé")
    if not isinstance(releve, dict) or not isinstance(releve.get("ues"), dict):
        raise ScodocInvalidPayload()

    return data
