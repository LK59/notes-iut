from __future__ import annotations

import pytest
import requests

from app.cas_client import CAS_BASE, DO_AUTH_URL, SITE_BASE, ScodocSession, login
from app.errors import (
    CasUnavailable,
    CasUnexpectedResponse,
    InvalidCredentials,
    ScodocInvalidPayload,
    ScodocUnavailable,
)

EXECUTION_PAGE = '<html><body><input type="hidden" name="execution" value="exec-token-123"></body></html>'
TICKET_URL = f"{SITE_BASE}/?ticket=ST-fake-ticket"


def _mock_happy_path_up_to_cas(requests_mock, *, cas_status: int, cas_headers: dict | None = None, cas_text: str = ""):
    """Enregistre doAuth (succès) + la réponse CAS/login qu'on veut tester."""
    requests_mock.get(DO_AUTH_URL, text=EXECUTION_PAGE)
    requests_mock.post(f"{CAS_BASE}/login", status_code=cas_status, headers=cas_headers or {}, text=cas_text)


def test_login_success(requests_mock):
    _mock_happy_path_up_to_cas(
        requests_mock, cas_status=302, cas_headers={"Location": TICKET_URL}
    )
    requests_mock.get(TICKET_URL, text="ok")
    requests_mock.post(f"{SITE_BASE}/services/data.php", json={"semestres": []})

    scodoc = login("toto", "secret")

    assert isinstance(scodoc, ScodocSession)
    assert scodoc.bootstrap_data == {"semestres": []}


def test_login_reports_stages(requests_mock):
    _mock_happy_path_up_to_cas(requests_mock, cas_status=302, cas_headers={"Location": TICKET_URL})
    requests_mock.get(TICKET_URL, text="ok")
    requests_mock.post(f"{SITE_BASE}/services/data.php", json={"semestres": []})

    stages: list[str] = []
    login("toto", "secret", on_stage=stages.append)

    assert stages == ["contacting_site", "cas_login", "validating_session", "loading_data"]


def test_login_invalid_credentials(requests_mock):
    html = '<html><body><div id="loginErrorsPanel">Mot de passe incorrect</div></body></html>'
    _mock_happy_path_up_to_cas(requests_mock, cas_status=200, cas_text=html)

    with pytest.raises(InvalidCredentials) as exc_info:
        login("toto", "wrong")
    assert exc_info.value.message == "Mot de passe incorrect"


def test_login_cas_response_without_error_panel_is_unexpected(requests_mock):
    html = "<html><head><title>Erreur inconnue</title></head><body>Rien à voir ici</body></html>"
    _mock_happy_path_up_to_cas(requests_mock, cas_status=200, cas_text=html)

    with pytest.raises(CasUnexpectedResponse):
        login("toto", "secret")


def test_login_doauth_timeout_raises_cas_unavailable(requests_mock):
    requests_mock.get(DO_AUTH_URL, exc=requests.exceptions.Timeout)

    with pytest.raises(CasUnavailable):
        login("toto", "secret")


def test_login_doauth_connection_error_raises_cas_unavailable(requests_mock):
    requests_mock.get(DO_AUTH_URL, exc=requests.exceptions.ConnectionError)

    with pytest.raises(CasUnavailable):
        login("toto", "secret")


def test_login_missing_execution_token_raises_unexpected(requests_mock):
    requests_mock.get(DO_AUTH_URL, text="<html><body>Pas de formulaire ici</body></html>")

    with pytest.raises(CasUnexpectedResponse):
        login("toto", "secret")


def test_login_redirect_without_ticket_raises_unexpected(requests_mock):
    _mock_happy_path_up_to_cas(
        requests_mock, cas_status=302, cas_headers={"Location": f"{SITE_BASE}/"}
    )

    with pytest.raises(CasUnexpectedResponse):
        login("toto", "secret")


def test_login_scodoc_unreachable_during_session_validation(requests_mock):
    _mock_happy_path_up_to_cas(requests_mock, cas_status=302, cas_headers={"Location": TICKET_URL})
    requests_mock.get(TICKET_URL, exc=requests.exceptions.ConnectionError)

    with pytest.raises(ScodocUnavailable):
        login("toto", "secret")


def test_post_data_timeout_raises_scodoc_unavailable(requests_mock):
    requests_mock.post(f"{SITE_BASE}/services/data.php", exc=requests.exceptions.Timeout)
    scodoc = ScodocSession(session=requests.Session())

    with pytest.raises(ScodocUnavailable):
        scodoc.premiere_connexion()


def test_post_data_non_json_raises_invalid_payload(requests_mock):
    requests_mock.post(f"{SITE_BASE}/services/data.php", text="<html>pas du json</html>")
    scodoc = ScodocSession(session=requests.Session())

    with pytest.raises(ScodocInvalidPayload):
        scodoc.premiere_connexion()


def test_post_data_server_error_raises_scodoc_unavailable(requests_mock):
    requests_mock.post(f"{SITE_BASE}/services/data.php", status_code=500)
    scodoc = ScodocSession(session=requests.Session())

    with pytest.raises(ScodocUnavailable):
        scodoc.premiere_connexion()


def test_post_data_client_error_raises_invalid_payload(requests_mock):
    requests_mock.post(f"{SITE_BASE}/services/data.php", status_code=400)
    scodoc = ScodocSession(session=requests.Session())

    with pytest.raises(ScodocInvalidPayload):
        scodoc.premiere_connexion()


def test_bulletin_pdf_non_pdf_content_raises_runtime_error(requests_mock):
    requests_mock.get(
        f"{SITE_BASE}/services/bulletin_PDF.php",
        text="Bulletin non disponible pour ce semestre.",
    )
    scodoc = ScodocSession(session=requests.Session())

    with pytest.raises(RuntimeError):
        scodoc.bulletin_pdf("S1")


def test_bulletin_pdf_success_returns_pdf_bytes(requests_mock):
    requests_mock.get(
        f"{SITE_BASE}/services/bulletin_PDF.php",
        content=b"%PDF-1.4 fake pdf content",
    )
    scodoc = ScodocSession(session=requests.Session())

    result = scodoc.bulletin_pdf("S1")

    assert result.startswith(b"%PDF")
