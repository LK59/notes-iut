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


class CasAuthenticationRefused(AppError):
    """Le CAS a refusé l'authentification pour une raison qui n'est pas « mot de passe
    incorrect » : compte verrouillé ou désactivé, mot de passe expiré, MFA exigé, page
    d'erreur inattendue. Distincte d'InvalidCredentials parce que le polling en tâche de
    fond révoque tous les remember-tokens du compte sur InvalidCredentials — le faire ici
    déconnecterait l'utilisateur de tous ses appareils pour un incident temporaire côté
    université."""

    status_code = 401
    code = "CAS_AUTHENTICATION_REFUSED"
    message = "Le CAS a refusé la connexion."


class CasUnavailable(AppError):
    status_code = 503
    code = "CAS_UNAVAILABLE"
    message = "Le service de connexion de l'université ne répond pas. Réessaie dans quelques minutes."
    retryable = True


class CasUnexpectedResponse(AppError):
    status_code = 502
    code = "CAS_UNEXPECTED_RESPONSE"
    message = "Le service de connexion a renvoye une reponse inattendue."
    retryable = True


class ScodocUnavailable(AppError):
    status_code = 503
    code = "SCODOC_UNAVAILABLE"
    message = "Le portail de notes ne répond pas. Réessaie plus tard."
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

