from __future__ import annotations


class AppError(Exception):
    status_code = 500
    code = "INTERNAL_ERROR"
    message = "Erreur interne."
    retryable = False

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.message)
        self.message = message or self.message


class InvalidCredentials(AppError):
    status_code = 401
    code = "INVALID_CREDENTIALS"
    message = "Identifiant ou mot de passe incorrect."


class CasUnavailable(AppError):
    status_code = 503
    code = "CAS_UNAVAILABLE"
    message = "Le service de connexion de l'universite ne repond pas. Reessaie dans quelques minutes."
    retryable = True


class CasUnexpectedResponse(AppError):
    status_code = 502
    code = "CAS_UNEXPECTED_RESPONSE"
    message = "Le service de connexion a renvoye une reponse inattendue."
    retryable = True


class ScodocUnavailable(AppError):
    status_code = 503
    code = "SCODOC_UNAVAILABLE"
    message = "Le portail de notes ne repond pas. Reessaie plus tard."
    retryable = True


class ScodocSessionRejected(AppError):
    status_code = 401
    code = "SCODOC_SESSION_REJECTED"
    message = "Le portail de notes a refuse la session. Reconnecte-toi."


class ScodocInvalidPayload(AppError):
    status_code = 502
    code = "SCODOC_INVALID_RESPONSE"
    message = "Le portail de notes a renvoye une reponse invalide."
    retryable = True


class RememberTokenMissing(AppError):
    status_code = 401
    code = "REMEMBER_TOKEN_MISSING"
    message = "Aucun token de reconnexion."


class RememberTokenInvalid(AppError):
    status_code = 401
    code = "REMEMBER_TOKEN_INVALID"
    message = "La reconnexion automatique n'est plus valide. Reconnecte-toi."


class RememberTokenDecryptError(AppError):
    status_code = 401
    code = "REMEMBER_TOKEN_DECRYPT_FAILED"
    message = "La reconnexion automatique n'est plus compatible avec la cle actuelle. Reconnecte-toi."

