# Notes IUT

Client étudiant **non officiel** (PWA mobile-first) pour consulter les relevés, les semestres et
certaines données ScoDoc de l'IUT d'Annecy via le CAS de l'université Savoie Mont Blanc.

Le projet est pensé pour un petit groupe d'utilisateurs qui veulent une interface plus lisible et
plus pratique que le portail natif, avec une expérience orientée mobile et quelques fonctions de
confort : cache hors ligne, simulation de notes, notifications push, thème clair/sombre.

## Ce que fait le projet

- Authentification via le CAS officiel de l'établissement.
- Récupération des données ScoDoc du compte connecté.
- Affichage des semestres, relevés, absences, évolution des moyennes, histogrammes de promo,
  bonus/malus, décisions de jury et notes en attente selon les données disponibles.
- Simulation locale des notes, sans aucun impact sur le portail distant.
- Notifications push (Web Push / VAPID) à la publication d'une nouvelle note.
- Prévisualisation et export du bulletin PDF officiel.
- Application installable (PWA) avec service worker et cache hors ligne partiel.
- Page publique de prévisionnel BUT R&T (`/preview/s5`, `/preview/s6`), sans authentification.

## Architecture

Le projet repose sur trois couches :

1. Un frontend React/Vite qui tourne dans le navigateur.
2. Un backend Python/FastAPI qui gère l'authentification, les sessions et les appels au portail.
3. Un portail distant CAS/ScoDoc qui fournit les données réelles.

Le navigateur ne parle jamais directement au CAS ni à ScoDoc. Il appelle le backend sur `/api/*`,
qui interroge ensuite `cas-uds.grenet.fr` puis `notes.iut-acy.univ-smb.fr` au nom de l'utilisateur.

### Frontend

Le frontend est situé dans [frontend/](frontend) et utilise :

- React 18 + TypeScript + Vite
- Tailwind CSS, avec un système de jetons de couleur (variables CSS `:root` / `:root.dark`)
- React Query pour le cache de données
- Recharts pour les graphiques, chargé en `lazy` (hors du bundle initial)
- `vite-plugin-pwa` en stratégie `injectManifest` ([frontend/src/sw.ts](frontend/src/sw.ts))

Le point d'entrée est [frontend/src/main.tsx](frontend/src/main.tsx), qui charge
[frontend/src/App.tsx](frontend/src/App.tsx).

### Backend

Le backend est situé dans [backend/app/](backend/app) et utilise :

- FastAPI pour exposer l'API HTTP
- requests pour interroger le portail distant
- BeautifulSoup4 pour extraire certaines informations depuis les pages CAS
- SQLite pour le cache, les sessions et les jetons de reconnexion
- `pywebpush` / `cryptography` pour les notifications push et le chiffrement des secrets

Le point d'entrée est [backend/app/main.py](backend/app/main.py), qui assemble l'application ;
la logique vit dans `routes/`, `cas_client.py` et le package `cache/`.

## Flux de fonctionnement

1. L'utilisateur ouvre le client web.
2. Le frontend interroge `/api/me` pour savoir si une session existe.
3. `POST /api/login` ne fait pas le login lui-même : il lance un thread et renvoie un `job_id`.
4. Le client poll `POST /api/login/status` (job_id dans le corps de la requête) jusqu'au résultat.
   Ce découpage évite les connexions muettes de plusieurs secondes, que les proxys à inspection
   TLS coupent ; le job remonte aussi une étape pour la barre de progression.
5. Le backend crée une session serveur opaque et renvoie un cookie `sid` HttpOnly.
6. Le frontend interroge ensuite les routes `/api/*`, que le backend relaie vers ScoDoc.

## Structure du projet

```text
backend/
  app/
    main.py            # Assemblage de l'app, middlewares, fallback SPA
    routes/            # auth, data, push, admin, health
    cas_client.py      # Client CAS + appels ScoDoc
    sessions.py        # Sessions serveur (mémoire + SQLite)
    push_polling.py    # Tâche de veille des nouvelles notes
    errors.py          # AppError et sous-classes sérialisées en JSON
    cache/             # Package SQLite (db, remember, sessions, push, vapid, ratelimit…)
  tests/               # pytest
frontend/
  src/
    App.tsx            # Point d'entrée UI et routage
    api.ts             # Couche d'accès à l'API backend
    schemas.ts         # Validation manuelle des réponses ScoDoc
    offlineCache.ts    # Cache localStorage best effort
    simulator.ts       # Simulation locale des notes (couvert par vitest)
    sw.ts              # Service worker (injectManifest)
    components/        # Composants UI, primitives dans ui.tsx
    hooks/             # useReleveData, useSimulation, …
  e2e/smoke.cjs        # Test de fumée Puppeteer (hors CI)
data/                  # Volume Docker : cache.db, clés VAPID
```

## Fonctionnalités principales

### Connexion

La connexion passe par le CAS officiel. Le mot de passe n'est jamais stocké en clair, ni côté
serveur ni dans le navigateur.

L'option « se souvenir de moi » pose un cookie `remember` opaque (30 jours, 7 jours d'inactivité
maximum, 6 jetons par compte). Les identifiants correspondants sont chiffrés côté serveur avec
`SECRET_KEY` ; le navigateur ne détient que le jeton. L'écran de connexion affiche un
avertissement, et `/api/me/sessions` permet de lister et révoquer ses sessions mémorisées.

### Consultation des données

Le dashboard permet notamment de consulter :

- les semestres disponibles ;
- le relevé du semestre sélectionné ;
- les absences ;
- la moyenne générale et les moyennes par UE, avec rangs et décisions de jury ;
- l'évolution des moyennes sur plusieurs semestres et la progression dans le semestre ;
- l'histogramme de la promo pour une évaluation ;
- certains bonus/malus et indicateurs annexes ;
- les notes publiées récemment et celles en attente quand elles sont détectables.

### Notifications push

Une tâche asyncio lancée au démarrage se reconnecte périodiquement avec les identifiants
« se souvenir de moi » des comptes abonnés, compare un instantané des notes et envoie une
notification Web Push (VAPID) à chaque nouvelle note. Réglable par `PUSH_*` dans `.env`.

### Mode hors ligne partiel

Deux couches : `localStorage` ([offlineCache.ts](frontend/src/offlineCache.ts), best effort) et le
service worker (stale-while-revalidate sur `/api/semestres` et `/api/releve/*`, NetworkFirst sur la
navigation avec repli sur l'`index.html` précaché). Une panne réseau ne déconnecte pas l'interface.

### Simulation locale

Le projet permet de modifier localement des notes pour estimer l'effet sur les moyennes, en
appliquant la pondération ScoDoc (`coef × poids[codeUE]`, une même ressource pouvant alimenter
plusieurs UE avec des poids différents). Ces simulations ne quittent jamais le navigateur.

## Développement

Les dépendances backend sont dans [backend/requirements.txt](backend/requirements.txt)
(et `requirements-dev.txt` pour les tests), les dépendances frontend dans
[frontend/package.json](frontend/package.json).

### Tests

```bash
# Backend (le job de CI ne construit pas le frontend : ne monter que backend/)
docker run --rm -v "$PWD/backend:/app" -w /app python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q"

# Frontend : typecheck + tests unitaires + build
docker run --rm -v "$PWD/frontend:/app" -w /app node:20-alpine \
  sh -c "npm ci && npm run typecheck && npm test && npm run build"
```

Un test de fumée navigateur (Puppeteer) couvre les pages publiques :
[frontend/e2e/smoke.cjs](frontend/e2e/smoke.cjs). Il n'est pas exécuté en CI ; la commande est dans
l'en-tête du fichier. Le lancer après toute modification de mise en page ou de défilement.

La CI GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) exécute les deux jobs
ci-dessus sur `main` et sur les pull requests.

## Lancer le projet

### Avec Docker

Le dépôt fournit un [Dockerfile](Dockerfile) multi-étages et un
[docker-compose.yml](docker-compose.yml). L'image construit le frontend, installe les dépendances
Python, lance `uvicorn` et sert `/api` **et** `frontend/dist`. Le Dockerfile installe aussi
manuellement l'intermédiaire TLS HARICA-GEANT, que le portail n'envoie pas dans sa poignée de main.

```bash
docker compose up -d --build
```

Le fichier `docker-compose.yml` suppose la présence d'un réseau Docker externe nommé `web`.

### Sans Docker

```bash
# Backend
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000

# Frontend
cd frontend && npm install && npm run dev
```

### Configuration

Copier [.env.example](.env.example) vers `.env` :

| Variable | Rôle |
| --- | --- |
| `SECRET_KEY` | Chiffrement des identifiants mémorisés (obligatoire) |
| `ADMIN_USERNAMES` | Liste séparée par des virgules ouvrant `/api/admin/*` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push (générés dans `data/` si absents) |
| `PUSH_POLL_INTERVAL` | Intervalle de veille des nouvelles notes |
| `PUSH_MAX_CONCURRENT_CHECKS` | Comptes vérifiés en parallèle |
| `PUSH_INITIAL_DELAY`, `PUSH_TICK_INTERVAL_SECONDS`, `PUSH_STAGGER_WINDOW_SECONDS`, `PUSH_BACKOFF_MAX_SECONDS` | Réglages fins du polling |

## Notes d'architecture et limites

- Les sessions serveur vivent en mémoire **et** en SQLite (cookies chiffrés) : elles survivent à un
  redémarrage du backend, avec un TTL de 4 h aligné sur le cookie CAS.
- L'état persistant tient dans un unique fichier SQLite (`data/cache.db`, volume Docker) :
  cache ScoDoc, sessions, jetons de reconnexion, abonnements push, limitation de débit.
- Le projet est conçu pour un usage étudiant léger, pas pour une forte charge multi-instances
  (état en mémoire partagé et tâche de polling unique).
- Les URLs CAS et portail sont ciblées sur l'environnement Annecy / Savoie Mont Blanc.
- Le backend dépend de la compatibilité du portail distant avec les endpoints ScoDoc utilisés.

## Sécurité et confidentialité

- Le mot de passe n'est jamais enregistré en clair : seul un chiffré côté serveur, si et seulement
  si l'utilisateur active « se souvenir de moi ».
- Le cookie de session est opaque, HttpOnly et de durée limitée.
- Les requêtes mutantes `/api/` exigent l'en-tête `X-Requested-With: XMLHttpRequest` (protection
  CSRF sans jeton dédié), et l'application envoie une CSP stricte (`script-src 'self'`,
  `font-src 'self'`, polices auto-hébergées).
- Les tentatives de connexion sont limitées par IP et par compte.
- La déconnexion purge quatre couches : session serveur, abonnement push, `localStorage` et caches
  du service worker — pour qu'aucune donnée ne fuite vers le compte suivant sur un appareil partagé.
- Le projet ne doit pas être présenté comme le portail officiel de l'IUT.

## Public visé

Ce projet est prévu pour :

- un usage étudiant ;
- une promo réduite ;
- un client secondaire plus pratique que le portail natif ;
- un déploiement simple derrière un reverse proxy comme Nginx Proxy Manager.

## Remerciements

Projet réalisé comme client alternatif pour consulter les données académiques d'un compte ScoDoc
via CAS. Sous licence MIT ([LICENSE](LICENSE)).
