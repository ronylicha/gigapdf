"""
Tests d'honnêteté des endpoints TODO.

Valide qu'aucun endpoint non implémenté ne retourne 200 avec de fausses
données. Cela garantit que l'API ne ment pas à ses consommateurs en simulant
un succès pour des opérations non réelles.

Contexte (post-mortem 04):
- Les endpoints stub retournaient 501 avec le message "Not implemented..."
- Ce test pin ce comportement : si un stub est accidentellement remplacé par
  un 200 avec des données inventées, ce test échoue et alerte l'équipe.
- Les endpoints peuvent retourner 401 (auth requise) ou 501 (stub honnête),
  mais JAMAIS 200 avec de fausses données.

Historique :
- 2026-06-13 : suppression des stubs text.py (5 endpoints) et annotations.py
  (3 endpoints) — modules retirés du codebase, la fonctionnalité équivalente
  vit dans le moteur TypeScript (/api/pdf/*). 21 → 13 endpoints.
- 2026-07-05 : suppression des 7 routers dépréciés (pages, forms, security,
  history, bookmarks, layers, modify) — tous superseded par le moteur
  TypeScript (/api/pdf/*). Les 13 stubs 501 restants vivaient dans forms.py (4),
  layers.py (5) et bookmarks.py (4) ; ils disparaissent avec leurs modules.
  13 → 0 stubs. Ces routes rejoignent la liste des routes supprimées : elles
  doivent désormais renvoyer 404/405, jamais 200 ni 501.

Les chemins de template comme /{document_id}/... sont remplacés par "test-doc-id"
et /{page_number}/... par "1" pour obtenir des URLs concrètes.
"""

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Stub endpoints — plus aucun stub 501 dans le codebase (voir historique).
# Si un nouveau stub honnête (501) est introduit, l'ajouter ici ET écrire un
# test fonctionnel dès qu'il est implémenté.
# ---------------------------------------------------------------------------

TODO_ENDPOINTS: list[tuple[str, str]] = []


# ---------------------------------------------------------------------------
# Routes de modules SUPPRIMÉS — doivent renvoyer 404/405 (jamais 200 ni 501).
# Une résurrection accidentelle (réintroduction d'un module ou d'un stub) serait
# détectée ici.
# ---------------------------------------------------------------------------

REMOVED_ROUTES = [
    # text.py & annotations.py — supprimés le 2026-06-13
    ("POST", "/api/v1/documents/test-doc-id/text/search"),
    ("POST", "/api/v1/documents/test-doc-id/text/replace"),
    ("GET",  "/api/v1/documents/test-doc-id/text/extract"),
    ("POST", "/api/v1/documents/test-doc-id/ocr"),
    ("GET",  "/api/v1/documents/test-doc-id/ocr/status"),
    ("GET",  "/api/v1/documents/test-doc-id/ocr/languages"),
    ("POST", "/api/v1/documents/test-doc-id/pages/1/annotations/markup"),
    ("POST", "/api/v1/documents/test-doc-id/pages/1/annotations/note"),
    ("POST", "/api/v1/documents/test-doc-id/pages/1/annotations/link"),
    # forms.py — supprimé le 2026-07-05 (superseded par /api/pdf/*)
    ("GET",  "/api/v1/documents/test-doc-id/forms/fields"),
    ("PUT",  "/api/v1/documents/test-doc-id/forms/fill"),
    ("POST", "/api/v1/documents/test-doc-id/pages/1/forms/fields"),
    ("POST", "/api/v1/documents/test-doc-id/forms/flatten"),
    # layers.py — supprimé le 2026-07-05 (superseded par /api/pdf/*)
    ("GET",    "/api/v1/documents/test-doc-id/layers"),
    ("POST",   "/api/v1/documents/test-doc-id/layers"),
    ("PATCH",  "/api/v1/documents/test-doc-id/layers/test-layer-id"),
    ("DELETE", "/api/v1/documents/test-doc-id/layers/test-layer-id"),
    ("PUT",    "/api/v1/documents/test-doc-id/layers/reorder"),
    # bookmarks.py — supprimé le 2026-07-05 (superseded par /api/pdf/*)
    ("GET",    "/api/v1/documents/test-doc-id/bookmarks"),
    ("POST",   "/api/v1/documents/test-doc-id/bookmarks"),
    ("PATCH",  "/api/v1/documents/test-doc-id/bookmarks/test-bookmark-id"),
    ("DELETE", "/api/v1/documents/test-doc-id/bookmarks/test-bookmark-id"),
    # pages.py / history.py / security.py / modify.py — supprimés le 2026-07-05.
    # Leurs opérations réelles vivent dans le moteur TypeScript (/api/pdf/*).
    ("GET",  "/api/v1/documents/test-doc-id/pages/1"),
    ("PUT",  "/api/v1/documents/test-doc-id/pages/reorder"),
    ("PUT",  "/api/v1/documents/test-doc-id/pages/1/rotate"),
    ("GET",  "/api/v1/documents/test-doc-id/history"),
    ("POST", "/api/v1/documents/test-doc-id/history/undo"),
    ("POST", "/api/v1/documents/test-doc-id/history/redo"),
    ("POST", "/api/v1/documents/test-doc-id/security/encrypt"),
    ("POST", "/api/v1/documents/test-doc-id/security/decrypt"),
    ("GET",  "/api/v1/documents/test-doc-id/security/permissions"),
    ("POST", "/api/v1/documents/test-doc-id/modify"),
]


@pytest.fixture(scope="module")
def api_client():
    """TestClient scoped to module to avoid re-creating the app per test."""
    import os
    os.environ.setdefault("APP_ENV", "testing")
    os.environ.setdefault("APP_SECRET_KEY", "test-secret-key-minimum-32-characters-long")

    from app.main import create_application
    application = create_application()
    with TestClient(application, raise_server_exceptions=False) as c:
        yield c


@pytest.mark.parametrize("method,path", REMOVED_ROUTES)
def test_removed_stub_routes_are_gone(api_client, method, path):
    """
    Les routes des modules supprimés (text.py, annotations.py le 2026-06-13 ;
    pages/forms/security/history/bookmarks/layers/modify le 2026-07-05) ne
    doivent plus exister : ni 200 (réimplémentation non testée), ni 501 (stub
    ressuscité). 404/405 attendus (401/429 tolérés si un middleware intercepte
    avant le routing).
    """
    response = api_client.request(
        method,
        path,
        json={},
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code not in (200, 501), (
        f"{method} {path} returned {response.status_code} — this route was "
        "removed (superseded by the TypeScript pdf-engine /api/pdf/* routes) "
        "and must not be resurrected silently."
    )


def test_todo_endpoints_count():
    """
    Pin le nombre exact de stubs 501 connus — actuellement 0.

    Si un nouveau stub honnête est introduit, ajoute-le à TODO_ENDPOINTS,
    ré-introduis un test paramétré vérifiant qu'il renvoie 401/403/404/405/
    422/429/501 (jamais 200), puis remplace-le par un test fonctionnel dès
    qu'il est implémenté.
    """
    assert len(TODO_ENDPOINTS) == 0, (
        f"Expected 0 TODO stub endpoints, got {len(TODO_ENDPOINTS)}. "
        "Add a parametrized honesty test for any new 501 stub."
    )


def test_health_endpoint_works(api_client):
    """Sanity check : /health retourne 200 pour confirmer que l'app tourne."""
    response = api_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
