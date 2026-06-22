"""Client CAS Apereo + API interne ScodocNotes (notes.iut-acy.univ-smb.fr).

Le site est un frontend PHP (phpCAS) : la page d'accueil "/" est statique et ne
valide jamais de ticket CAS elle-même. Le seul point d'entrée qui déclenche
phpCAS::forceAuthentication() est /services/doAuth.php?href=<retour>. C'est lui
qu'il faut visiter pour déclencher la redirection vers le CAS, valider le ticket
côté serveur (PHPSESSID), puis revenir sur le site avec une session authentifiée
que data.php acceptera.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup

CAS_BASE = "https://cas-uds.grenet.fr"
SITE_BASE = "https://notes.iut-acy.univ-smb.fr"
DO_AUTH_URL = f"{SITE_BASE}/services/doAuth.php"

EXECUTION_RE = re.compile(r'name="execution" value="([^"]+)"')

logger = logging.getLogger("notes_iut.cas")


class CasAuthError(Exception):
    pass


@dataclass
class ScodocSession:
    session: requests.Session

    def post_data(self, query: str, **params) -> dict:
        # data.php lit ses paramètres via $_GET (même en POST) : il faut donc les
        # passer en query string, pas dans le corps de la requête.
        url = f"{SITE_BASE}/services/data.php"
        resp = self.session.post(
            url,
            params={"q": query, **params},
            headers={"Content-type": "application/x-www-form-urlencoded"},
            timeout=20,
        )
        resp.raise_for_status()
        try:
            return resp.json()
        except ValueError:
            logger.warning(
                "Réponse data.php non-JSON : status=%s url=%s body[:1500]=%r",
                resp.status_code,
                resp.url,
                resp.text[:1500],
            )
            raise

    def premiere_connexion(self) -> dict:
        return self.post_data("dataPremièreConnexion")

    def releve_etudiant(self, formsemestre_id: str) -> dict:
        return self.post_data("relevéEtudiant", semestre=formsemestre_id)

    def liste_notes(self, eval_id: str) -> dict:
        """Notes anonymisées de toute la promo pour une évaluation (si l'admin a activé l'histogramme)."""
        return self.post_data("listeNotes", eval=eval_id)

    def bulletin_pdf(self, formsemestre_id: str, type_: str = "BUT") -> bytes:
        """Bulletin officiel généré par ScoDoc (pas notre export navigateur) — si l'admin l'autorise."""
        resp = self.session.get(
            f"{SITE_BASE}/services/bulletin_PDF.php",
            params={"sem_id": formsemestre_id, "type": type_},
            timeout=30,
        )
        resp.raise_for_status()
        if not resp.content.startswith(b"%PDF"):
            message = resp.text.strip() or "Le portail n'a pas renvoyé de PDF valide."
            raise RuntimeError(message)
        return resp.content

    def student_photo(self) -> tuple[bytes, str]:
        """Photo de l'étudiant connecté (accessible pour soi-même sans droits particuliers)."""
        resp = self.session.post(
            f"{SITE_BASE}/services/data.php",
            params={"q": "getStudentPic"},
            timeout=20,
        )
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "image/jpeg")


def _extract_cas_error(html: str) -> str:
    """Récupère le message d'erreur réel affiché par le CAS (mauvais mdp, MFA requis, compte verrouillé, etc.)."""
    soup = BeautifulSoup(html, "html.parser")
    panel = soup.find(id="loginErrorsPanel")
    if panel:
        text = panel.get_text(strip=True)
        if text:
            return text
    return "Échec de l'authentification CAS (réponse inattendue du portail)"


def login(username: str, password: str) -> ScodocSession:
    """Effectue le flow CAS complet et retourne une session HTTP authentifiée."""
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9",
        }
    )

    # doAuth.php, sans ticket, redirige (302) vers le CAS avec le bon `service`
    # généré par phpCAS lui-même (basé sur HTTP_HOST, sans le chemin) : on laisse
    # requests suivre cette redirection pour atterrir sur la vraie page de login.
    resp = session.get(DO_AUTH_URL, params={"href": f"{SITE_BASE}/"}, timeout=20)
    resp.raise_for_status()
    login_url = resp.url

    match = EXECUTION_RE.search(resp.text)
    if not match:
        soup = BeautifulSoup(resp.text, "html.parser")
        field = soup.find("input", {"name": "execution"})
        if not field or not field.get("value"):
            raise CasAuthError("Impossible de récupérer le jeton 'execution' depuis la page CAS")
        execution = field["value"]
    else:
        execution = match.group(1)

    post_data = {
        "username": username,
        "password": password,
        "execution": execution,
        "_eventId": "submit",
        "geolocation": "",
    }
    resp = session.post(
        f"{CAS_BASE}/login",
        data=post_data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": CAS_BASE,
            "Referer": login_url,
        },
        allow_redirects=False,
        timeout=20,
    )

    if resp.status_code not in (301, 302, 303, 307, 308):
        message = _extract_cas_error(resp.text)
        if message.startswith("Échec de l'authentification CAS"):
            title = BeautifulSoup(resp.text, "html.parser").title
            logger.warning(
                "Réponse CAS non reconnue : status=%s title=%r set-cookie=%r body[:1500]=%r",
                resp.status_code,
                title.get_text(strip=True) if title else None,
                resp.headers.get("Set-Cookie"),
                resp.text[:1500],
            )
        raise CasAuthError(message)

    location = resp.headers.get("Location")
    if not location or "ticket=" not in location:
        raise CasAuthError("Réponse CAS inattendue : pas de ticket dans la redirection")

    resp = session.get(location, timeout=20)
    resp.raise_for_status()

    return ScodocSession(session=session)
