"""Détection des nouvelles notes et choix du semestre surveillé par le polling push.

Ces deux points sont la seule chose qui décide si une notification part ou non, et ils
étaient tous les deux faux : voir _numeric_note_value et _current_semestre_with_releve.
"""
from __future__ import annotations

import pytest

from app.push_polling import (
    _current_semestre_with_releve,
    _extract_grade_snapshot,
    _find_new_grades,
    _grade_tag,
    _numeric_note_value,
    sorted_semestres,
)


def _releve(evaluations: list[dict]) -> dict:
    return {
        "ues": {},
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
