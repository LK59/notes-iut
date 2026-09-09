"""Détection des nouvelles notes et choix du semestre surveillé par le polling push.

Ces deux points sont la seule chose qui décide si une notification part ou non, et ils
étaient tous les deux faux : voir _numeric_note_value et _current_semestre_with_releve.
"""
from __future__ import annotations

import pytest

from app.push_polling import (
    _current_semestre_with_releve,
    _decision_state,
    _extract_grade_snapshot,
    _find_new_grades,
    _find_updated_grades,
    _grade_tag,
    _maybe_notify_decision,
    _numeric_note_value,
    _updated_message_payload,
    sorted_semestres,
)


def _releve(evaluations: list[dict], semestre: dict | None = None) -> dict:
    return {
        "ues": {},
        "semestre": semestre or {},
        "ressources": {"R1.01": {"titre": "Initiation aux réseaux", "evaluations": evaluations}},
        "saes": {},
    }


def test_note_non_publiee_de_scodoc_compte_comme_absence_de_note():
    # ScoDoc n'envoie pas null pour une évaluation non notée, mais la chaîne "~".
    assert _numeric_note_value("~") is None
    assert _numeric_note_value(None) is None
    assert _numeric_note_value("") is None
    assert _numeric_note_value("14.50") == 14.5
    assert _numeric_note_value(12) == 12.0


def test_snapshot_ne_memorise_pas_les_notes_non_publiees():
    snapshot = _extract_grade_snapshot(_releve([{"id": 1, "note": {"value": "~"}}]))
    assert snapshot == {"1": None}


def test_notification_quand_une_evaluation_deja_presente_recoit_sa_note():
    """Le cas normal : le prof crée l'évaluation (note "~"), puis saisit les notes plus tard.
    C'est précisément celui qui ne déclenchait jamais de notification."""
    avant = _releve([{"id": 1, "description": "DS1", "note": {"value": "~"}}])
    apres = _releve([{"id": 1, "description": "DS1", "note": {"value": "14.50"}}])

    new_grades = _find_new_grades(_extract_grade_snapshot(avant), _extract_grade_snapshot(apres), apres)

    assert [g["description"] for g in new_grades] == ["DS1"]
    assert new_grades[0]["value"] == "14.50"


def test_snapshot_hérité_contenant_un_tilde_est_rattrapé():
    """Les snapshots écrits par la version précédente contiennent "~" : la note publiée
    depuis doit quand même être notifiée, pas considérée comme déjà vue."""
    apres = _releve([{"id": 1, "description": "DS1", "note": {"value": "9"}}])

    new_grades = _find_new_grades({"1": "~"}, _extract_grade_snapshot(apres), apres)

    assert len(new_grades) == 1


def test_pas_de_notification_quand_la_note_ne_change_pas():
    releve = _releve([{"id": 1, "description": "DS1", "note": {"value": "14.50"}}])
    snapshot = _extract_grade_snapshot(releve)

    assert _find_new_grades(snapshot, snapshot, releve) == []


def test_pas_de_notification_pour_une_evaluation_toujours_sans_note():
    releve = _releve([{"id": 1, "description": "DS1", "note": {"value": "~"}}])
    snapshot = _extract_grade_snapshot(releve)

    assert _find_new_grades(snapshot, snapshot, releve) == []


def test_tag_distinct_par_lot_de_notes():
    a = _grade_tag([{"id": "1"}])
    b = _grade_tag([{"id": "2"}])
    assert a != b
    assert _grade_tag([{"id": "1"}]) == a


def test_semestres_tries_chronologiquement():
    semestres = [
        {"formsemestre_id": 984, "semestre_id": 4, "annee_scolaire": "2025/2026"},
        {"formsemestre_id": 744, "semestre_id": 1, "annee_scolaire": "2024/2025"},
        {"formsemestre_id": 920, "semestre_id": 3, "annee_scolaire": "2025/2026"},
    ]
    assert [s["formsemestre_id"] for s in sorted_semestres(semestres)] == [744, 920, 984]


class _FakeScodoc:
    def __init__(self, releves: dict[str, dict]) -> None:
        self.releves = releves
        self.calls: list[str] = []

    def releve_etudiant(self, semestre_id: str) -> dict:
        self.calls.append(semestre_id)
        return {"relevé": self.releves[semestre_id]}


def test_semestre_surveille_retombe_sur_le_precedent_si_le_dernier_est_vide():
    """À la rentrée, ScoDoc crée le formsemestre de la nouvelle année, vide, et il devient le
    dernier de la liste : le polling se calait dessus et ne voyait plus jamais les notes qui
    tombaient encore sur le semestre précédent."""
    scodoc = _FakeScodoc(
        {
            "984": _releve([{"id": 1, "note": {"value": "12"}}]),
            "1080": _releve([]),
        }
    )
    semestres = [
        {"formsemestre_id": 984, "semestre_id": 4, "annee_scolaire": "2025/2026"},
        {"formsemestre_id": 1080, "semestre_id": 5, "annee_scolaire": "2026/2027"},
    ]

    semestre_id, releve = _current_semestre_with_releve(scodoc, semestres)

    assert semestre_id == "984"
    assert releve == scodoc.releves["984"]


def test_semestre_surveille_reste_le_dernier_des_qu_il_a_une_evaluation():
    scodoc = _FakeScodoc({"1080": _releve([{"id": 9, "note": {"value": "~"}}])})
    semestres = [
        {"formsemestre_id": 984, "semestre_id": 4, "annee_scolaire": "2025/2026"},
        {"formsemestre_id": 1080, "semestre_id": 5, "annee_scolaire": "2026/2027"},
    ]

    semestre_id, _ = _current_semestre_with_releve(scodoc, semestres)

    assert semestre_id == "1080"
    assert scodoc.calls == ["1080"]  # pas d'appel supplémentaire quand le dernier suffit


def test_semestre_surveille_sans_semestre_exploitable():
    assert _current_semestre_with_releve(_FakeScodoc({}), [{"titre": "sans id"}]) is None


# ── Notes modifiées ──────────────────────────────────────────────────────────

def test_notification_quand_une_note_deja_publiee_est_corrigee():
    """Correction après réclamation, saisie rectifiée : rien n'était signalé, seule la
    première publication déclenchait une notification."""
    avant = _releve([{"id": 1, "description": "DS1", "note": {"value": "8.00"}}])
    apres = _releve([{"id": 1, "description": "DS1", "note": {"value": "14.00"}}])

    updated = _find_updated_grades(_extract_grade_snapshot(avant), _extract_grade_snapshot(apres), apres)

    assert len(updated) == 1
    assert updated[0]["previous"] == "8.00"
    assert updated[0]["value"] == "14.00"


def test_une_premiere_publication_nest_pas_une_modification():
    avant = _releve([{"id": 1, "description": "DS1", "note": {"value": "~"}}])
    apres = _releve([{"id": 1, "description": "DS1", "note": {"value": "14.00"}}])
    snap_avant, snap_apres = _extract_grade_snapshot(avant), _extract_grade_snapshot(apres)

    assert _find_updated_grades(snap_avant, snap_apres, apres) == []
    assert len(_find_new_grades(snap_avant, snap_apres, apres)) == 1


def test_le_retrait_dune_note_nest_pas_notifie():
    """ScoDoc repasse parfois transitoirement par "~" pendant un recalcul : une alerte
    « ta note a disparu » serait une fausse alerte anxiogène."""
    avant = _releve([{"id": 1, "description": "DS1", "note": {"value": "14.00"}}])
    apres = _releve([{"id": 1, "description": "DS1", "note": {"value": "~"}}])

    assert _find_updated_grades(_extract_grade_snapshot(avant), _extract_grade_snapshot(apres), apres) == []


def test_message_de_note_modifiee_montre_lancienne_et_la_nouvelle_valeur():
    updated = [{"id": "1", "description": "DS1", "module": "R1.01 – Réseaux", "previous": "8.00", "value": "14.00"}]

    avec = _updated_message_payload(updated, include_grade_value=True)
    sans = _updated_message_payload(updated, include_grade_value=False)

    assert "8.00 → 14.00/20" in avec["body"]
    assert "14.00" not in sans["body"]
    assert avec["tag"] != _grade_tag(updated)  # ne remplace pas la notification de nouvelle note


# ── Décision de jury ─────────────────────────────────────────────────────────

def test_empreinte_de_decision_vide_hors_periode_de_jury():
    assert _decision_state(_releve([])) == ("", "")


def test_empreinte_de_decision_change_avec_la_decision():
    admis = _releve([], {"situation": "Admis", "decision_annee": {"code": "ADM"}})
    ajourne = _releve([], {"situation": "Ajourné", "decision_annee": {"code": "AJ"}})

    empreinte_admis, resume = _decision_state(admis)
    assert empreinte_admis and resume == "Admis"
    assert _decision_state(ajourne)[0] != empreinte_admis


def test_decision_notifiee_seulement_a_partir_de_la_deuxieme_observation(monkeypatch):
    """Sans ça, tout étudiant déjà passé en jury recevrait une notification au premier poll
    suivant le déploiement."""
    from app import cache
    import app.push_polling as pp

    envois: list[dict] = []
    monkeypatch.setattr(pp, "_send_push", lambda subs, message: envois.append(message) or 1)
    # La clé VAPID courante, sinon get_push_subscriptions() considère l'abonnement périmé
    # et le supprime : le test passerait sans qu'aucun abonné ne soit réellement trouvé.
    _, vapid_public_key = cache.get_or_create_vapid_keys()
    cache.upsert_push_subscription("etu", "https://push.example/a", "p", "a", vapid_public_key, False)

    sans_decision = _releve([])
    assert pp._maybe_notify_decision("etu", "984", sans_decision) == (0, False)
    assert envois == []

    admis = _releve([], {"situation": "Admis"})
    sent, pending = pp._maybe_notify_decision("etu", "984", admis)
    assert (sent, pending) == (1, False)
    assert envois[-1]["title"] == "Décision de jury publiée"
    assert envois[-1]["body"] == "Admis"

    # Rejouée à l'identique au cycle suivant : plus rien.
    assert pp._maybe_notify_decision("etu", "984", admis) == (0, False)
    assert len(envois) == 1


def test_decision_non_memorisee_si_la_notification_na_pas_pu_partir(monkeypatch):
    from app import cache
    import app.push_polling as pp

    monkeypatch.setattr(pp, "_send_push", lambda subs, message: 0)
    # La clé VAPID courante, sinon get_push_subscriptions() considère l'abonnement périmé
    # et le supprime : le test passerait sans qu'aucun abonné ne soit réellement trouvé.
    _, vapid_public_key = cache.get_or_create_vapid_keys()
    cache.upsert_push_subscription("etu", "https://push.example/a", "p", "a", vapid_public_key, False)
    pp._maybe_notify_decision("etu", "984", _releve([]))

    admis = _releve([], {"situation": "Admis"})
    assert pp._maybe_notify_decision("etu", "984", admis) == (0, True)
    assert cache.get_push_decision_state("etu") == ("984", "")  # inchangé, retentera


def test_le_releve_embarque_dans_le_bootstrap_evite_un_appel_au_portail():
    """dataPremièreConnexion renvoie déjà le relevé du dernier semestre : le refetcher à
    chaque cycle doublait les appels au portail pour chaque abonné."""
    releve = _releve([{"id": 1, "note": {"value": "12"}}])
    releve["formsemestre_id"] = 1080
    scodoc = _FakeScodoc({})
    semestres = [{"formsemestre_id": 1080, "semestre_id": 5, "annee_scolaire": "2026/2027"}]

    semestre_id, obtenu = _current_semestre_with_releve(scodoc, semestres, {"relevé": releve})

    assert (semestre_id, obtenu) == ("1080", releve)
    assert scodoc.calls == []


def test_le_releve_embarque_est_ignore_sil_porte_sur_un_autre_semestre():
    autre = _releve([{"id": 9, "note": {"value": "12"}}])
    autre["formsemestre_id"] = 984
    attendu = _releve([{"id": 1, "note": {"value": "15"}}])
    scodoc = _FakeScodoc({"1080": attendu})
    semestres = [{"formsemestre_id": 1080, "semestre_id": 5, "annee_scolaire": "2026/2027"}]

    semestre_id, obtenu = _current_semestre_with_releve(scodoc, semestres, {"relevé": autre})

    assert (semestre_id, obtenu) == ("1080", attendu)
    assert scodoc.calls == ["1080"]


def _deadlines(idle_dans_secondes: float, absolu_dans_secondes: float):
    import time

    now = time.time()
    return {
        "token_hash": "peu-importe",
        "idle_deadline": now + idle_dans_secondes,
        "absolute_deadline": now + absolu_dans_secondes,
    }


def test_absolute_reauth_warning_leaves_three_days(monkeypatch):
    """L'expiration du plafond absolu coupe le polling — donc les notifications — et exige
    de ressaisir le mot de passe. 24 h d'avance, annoncées par une notification qu'on peut
    balayer ou rater pendant un week-end, laissaient la coupure passer en silence."""
    from app import push_polling

    heure = 3600
    monkeypatch.setattr(
        push_polling.cache, "get_background_token_deadlines",
        lambda username: _deadlines(30 * 24 * heure, 60 * heure),
    )
    assert push_polling._reauth_warning_for_username("etu") == "absolute"


def test_idle_reauth_warning_stays_at_one_day(monkeypatch):
    """L'inactivité se rattrape en ouvrant l'app, et l'ouvrir suffit à repousser l'échéance :
    prévenir 3 jours à l'avance notifierait quiconque passe 4 jours sans regarder ses notes."""
    from app import push_polling

    heure = 3600
    monkeypatch.setattr(
        push_polling.cache, "get_background_token_deadlines",
        lambda username: _deadlines(60 * heure, 30 * 24 * heure),
    )
    assert push_polling._reauth_warning_for_username("etu") is None

    monkeypatch.setattr(
        push_polling.cache, "get_background_token_deadlines",
        lambda username: _deadlines(12 * heure, 30 * 24 * heure),
    )
    assert push_polling._reauth_warning_for_username("etu") == "idle"
