# Notes IUT

Client étudiant non officiel pour consulter les relevés, les semestres et certaines données ScoDoc via CAS.

Le projet est pensé pour un petit groupe d'utilisateurs qui veulent une interface plus lisible et plus pratique que le portail natif, avec une expérience orientée mobile et quelques fonctions de confort comme le cache hors ligne, la simulation de notes et le thème clair/sombre.

## Ce que fait le projet

- Authentification via le CAS officiel de l'établissement.
- Récupération des données ScoDoc du compte connecté.
- Affichage des semestres, relevés, absences, évolution des moyennes, histogrammes et bonus/malus selon les données disponibles.
- Prévisualisation et export du bulletin PDF officiel.
- Cache local best effort pour améliorer la réactivité et l'usage hors ligne partiel.
- Mode de simulation locale des notes, sans impact sur le portail distant.

## Architecture

Le projet repose sur trois couches:

1. Un frontend React/Vite qui tourne dans le navigateur.
2. Un backend Python/FastAPI qui gère l'authentification, les sessions et les appels au portail.
3. Un portail distant CAS/ScoDoc qui fournit les données réelles.

Le navigateur ne parle pas directement au CAS ni à ScoDoc. Il appelle d'abord le backend sur `/api/*`, puis le backend interroge le portail officiel au nom de l'utilisateur connecté.

### Frontend

Le frontend est situé dans [frontend/](frontend) et utilise:

- React
- Vite
- TypeScript
- Tailwind CSS
- Recharts pour les graphiques

Le point d'entrée est [frontend/src/main.tsx](frontend/src/main.tsx), qui charge [frontend/src/App.tsx](frontend/src/App.tsx).

### Backend

Le backend est situé dans [backend/app/](backend/app) et utilise:

- FastAPI pour exposer l'API HTTP
- requests pour interroger le portail distant
- BeautifulSoup4 pour extraire certaines informations depuis les pages CAS

Le point d'entrée est [backend/app/main.py](backend/app/main.py).

## Flux de fonctionnement

1. L'utilisateur ouvre le client web.
2. Le frontend vérifie si une session existe.
3. Lors de la connexion, le backend contacte le CAS officiel.
4. Le backend crée une session serveur opaque et renvoie un cookie HttpOnly.
5. Le frontend interroge ensuite les routes `/api/*` pour obtenir les données.
6. Le backend relaie les appels vers le portail ScoDoc et renvoie les réponses au frontend.

## Structure du projet

```text
backend/
  app/
    main.py           # API FastAPI et routes principales
    cas_client.py     # Client CAS + appels ScoDoc
    sessions.py       # Sessions serveur en mémoire
    cache.py          # Cache côté backend
    data/             # Données backend locales
frontend/
  src/
    App.tsx           # Point d'entrée UI
    api.ts            # Couche d'accès à l'API backend
    offlineCache.ts   # Cache localStorage best effort
    simulator.ts      # Simulation locale des notes
    components/       # Composants UI
```

## Fonctionnalités principales

### Connexion

La connexion passe par le CAS officiel. Le mot de passe n'est pas stocké côté serveur.

Le projet propose aussi une option "se souvenir de moi". Quand elle est activée, les identifiants sont conservés dans le navigateur pour permettre une reconnexion automatique. Un avertissement clair est affiché à l'utilisateur sur l'écran de connexion.

### Consultation des données

Le dashboard permet notamment de consulter:

- les semestres disponibles;
- le relevé du semestre courant;
- les absences;
- la moyenne générale et les moyennes par UE;
- l'évolution des moyennes sur plusieurs semestres;
- certains bonus/malus et indicateurs annexes;
- les notes publiées récemment quand elles sont détectables.

### Mode hors ligne partiel

Le frontend conserve localement certaines données pour améliorer l'expérience en cas de connexion instable ou d'absence temporaire de réseau.

### Simulation locale

Le projet permet de modifier localement des notes pour estimer l'effet sur les moyennes. Ces simulations ne sont jamais envoyées au portail distant.

## Dépendances techniques

### Backend Python

Les dépendances sont listées dans [backend/requirements.txt](backend/requirements.txt).

### Frontend Node.js

Les dépendances frontend sont listées dans [frontend/package.json](frontend/package.json).

## Lancer le projet

### Avec Docker

Le dépôt fournit un [Dockerfile](Dockerfile) et un [docker-compose.yml](docker-compose.yml).

Le conteneur final:

- construit le frontend;
- installe les dépendances Python;
- lance le backend avec `uvicorn`;
- sert aussi le frontend compilé si `frontend/dist` est présent.

Exemple de lancement:

```bash
docker compose up --build
```

Le fichier `docker-compose.yml` suppose la présence d'un réseau Docker externe nommé `web`.

### Sans Docker

#### Backend

```bash
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

Pour générer un build de production:

```bash
cd frontend
npm run build
```

## Notes d'architecture et limites

- Les sessions serveur sont en mémoire. Un redémarrage du backend les efface.
- Le projet est conçu pour un usage étudiant léger, pas pour une forte charge multi-instances.
- Les URLs CAS et portail sont actuellement ciblées sur l'environnement Annecy / Savoie Mont Blanc.
- Le backend dépend de la compatibilité du portail distant avec les endpoints ScoDoc utilisés.
- Le backend n'embarque pas de base de données: l'état persistant est limité au cache local côté navigateur et aux données temporaires en mémoire.

## Sécurité et confidentialité

- Le mot de passe n'est jamais enregistré côté serveur.
- Le cookie de session est HttpOnly.
- L'option "se souvenir de moi" stocke les identifiants dans le navigateur pendant une durée limitée; elle doit être utilisée uniquement sur un appareil personnel.
- Le projet ne doit pas être présenté comme le portail officiel de l'IUT.

## Public visé

Ce projet est prévu pour:

- un usage étudiant;
- une promo réduite;
- un client secondaire plus pratique que le portail natif;
- un déploiement simple derrière un reverse proxy comme Nginx Proxy Manager.

## Déploiement

Le projet peut être placé derrière un reverse proxy HTTPS. Dans ce cas, le backend fonctionne comme une application web interne, et le proxy gère l'exposition publique.


## Remerciements

Projet réalisé comme client alternatif pour consulter les données académiques d'un compte ScoDoc via CAS.

