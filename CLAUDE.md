# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Contexte

Client étudiant **non officiel** (PWA mobile-first) pour consulter les notes ScoDoc de l'IUT
d'Annecy via le CAS de l'université. Frontend React/Vite + backend FastAPI qui joue le rôle de
proxy authentifié vers `cas-uds.grenet.fr` et `notes.iut-acy.univ-smb.fr`. Le navigateur ne parle
jamais directement au CAS ni à ScoDoc.

Le code et les commentaires sont **en français** — s'y tenir. Les commentaires existants
expliquent presque toujours *pourquoi* (quel bug, quelle contrainte du portail distant), pas
*quoi* : conserver ce style plutôt que de les remplacer par des paraphrases du code.

## Commandes

**Aucun toolchain local** : pas de `node`, `npm`, ni de dépendances Python installées sur cette
machine. Tout passe par Docker, avec le dépôt monté.

```bash
# Tests backend — monter UNIQUEMENT backend/ (voir « Piège CI » plus bas)
docker run --rm -v "$PWD/backend:/app" -w /app python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest -q"

# Un seul test
#   ... python -m pytest -q tests/test_auth.py::test_login_success_sets_session_cookie

# Frontend : typecheck + tests unitaires + build (ce que fait la CI)
docker run --rm -v "$PWD/frontend:/app" -w /app node:20-alpine \
  sh -c "npm ci && npm run typecheck && npm test && npm run build"
#   npm test -- src/simulator.test.ts   pour un fichier seul

# Déploiement local (le conteneur `notes-iut` tourne derrière nginx-proxy-manager)
docker compose up -d --build     # nécessite le réseau docker externe `web`
```

### Test de fumée navigateur

`frontend/e2e/smoke.cjs` (Puppeteer, **hors CI** : pas de navigateur côté runner). Il couvre les
pages publiques — connexion et `/preview/s5` — et vérifie débordement horizontal, erreurs console,
police réellement appliquée, défilement qui ne remonte pas tout seul, bas de page atteignable,
contenu non tronqué par les replis. C'est lui qui a révélé deux bugs invisibles autrement (barre de
sections qui remontait la page, script de thème bloqué par la CSP) : **le lancer après toute
modification de mise en page ou de défilement.** La commande exacte est dans l'en-tête du fichier.

Les vues authentifiées ne sont pas couvertes : ça demanderait des identifiants CAS réels. Ne jamais
demander, accepter, journaliser ou committer ceux de l'utilisateur — le CAS est un SSO qui couvre
aussi mail, Moodle, eduroam, ENT et VPN. La piste convenue, si le sujet revient, est un jeu de
fixtures anonymisées produit par un script que l'utilisateur exécute lui-même.

### Piège CI (déjà tombé dedans une fois)

Le job backend de la CI **ne construit pas le frontend**, donc `frontend/dist` est absent et le
fallback SPA de `main.py` n'est pas enregistré. Un test qui passe en local avec un `dist` présent
peut donc échouer en CI : les 404 ne prennent pas le même chemin de routage. D'où la commande de
test ci-dessus qui ne monte que `backend/`. Vérifier ainsi **avant** d'annoncer que les tests
passent.

## Architecture backend

`backend/app/main.py` assemble l'application ; la logique métier vit dans `routes/`, `cas_client.py`
et le package `cache/`.

- **Login asynchrone.** `POST /api/login` ne fait pas le login CAS : il lance un thread et renvoie
  un `job_id` que le client poll sur `POST /api/login/status`, job_id dans le CORPS de la
  requête (même schéma pour `/api/refresh`) : uvicorn journalise le chemin de chaque requête,
  et cet identifiant suffit à obtenir un cookie de session tant que le job est lisible. La
  forme `GET /api/login/status/{job_id}` reste servie pour les onglets ouverts au moment d'un
  déploiement, mais y consomme le job dès la première lecture.
  Motif : la chaîne doAuth → CAS → validation ticket → data.php prend plusieurs secondes, et les
  proxys à inspection TLS coupent les connexions muettes. Chaque requête HTTP reste donc <1s. Le job
  remonte aussi une `stage` pour la barre de progression du client.
- **Sessions.** Cookie `sid` opaque et HttpOnly, TTL 4h, stocké en mémoire (`sessions.py`) **et**
  en SQLite (cookies chiffrés) pour survivre à un redémarrage. `restore_sessions()` les recharge au
  démarrage. Cookie `remember` séparé (30 j) : mot de passe chiffré côté serveur, jamais en clair
  dans le navigateur.
- **Erreurs.** Toute erreur métier est une sous-classe d'`AppError` (`errors.py`) portant
  `status_code`/`code`/`message`/`retryable`, sérialisée en `{detail, error: {code, message,
  retryable}}`. Le client (`api.ts`) lit `error.code`. Le handler HTTP générique est enregistré sur
  `starlette.exceptions.HTTPException`, **pas** celle de FastAPI, pour couvrir aussi les 404 levées
  par le routeur lui-même.
- **Cache SQLite** (`data/cache.db`, volume Docker). Le package `cache/` est découpé par domaine
  mais réexporte une API plate : le reste du code fait `from . import cache` puis
  `cache.ma_fonction(...)`. Ajouter une fonction implique de l'exporter dans `cache/__init__.py`.
- **Middlewares**, dans l'ordre qui compte : GZip ajouté en premier (wrapper intérieur), Brotli en
  second (extérieur, donc prioritaire) ; CSRF (exige `X-Requested-With: XMLHttpRequest` sur toute
  requête mutante `/api/`, ce qui remplace un token dédié) ; en-têtes de sécurité dont une CSP
  stricte — `font-src 'self'` impose les polices auto-hébergées, `script-src 'self'` interdit tout
  script inline (d'où `public/theme-init.js`), `style-src` garde `'unsafe-inline'` pour recharts.
- **Logs.** `_log_event()` (`logging_utils.py`) écrit du JSON sur le logger `notes_iut.api`, câblé
  par `configure_logging()` appelé à l'import de `main.py`. Ne pas supprimer cet appel : uvicorn ne
  configure que ses propres loggers, la racine reste sans handler, et le logger retombe alors au
  niveau WARNING du handler de dernier recours — tous les événements INFO disparaissent
  silencieusement de `docker logs`. Niveau réglable par `LOG_LEVEL`.
- **Polling push** (`push_polling.py`) : tâche asyncio lancée dans `lifespan`, se reconnecte avec
  les identifiants « se souvenir de moi », compare un snapshot de notes et notifie via VAPID. Voir
  la mémoire `project_push_notifications.md` pour le piège du format de clé privée. Deux règles
  non négociables, chacune ayant déjà rendu les notifications muettes : une évaluation sans note
  vaut `"~"` chez ScoDoc et **pas** `null` (d'où `_numeric_note_value`, aligné sur le
  `numericNoteValue` du client) ; et le semestre à surveiller n'est pas bêtement le dernier de la
  liste, car ScoDoc crée celui de la nouvelle année vide dès la rentrée (d'où
  `_current_semestre_with_releve`, qui retombe sur le précédent tant que le dernier n'a aucune
  évaluation). Le client, lui, ouvre **toujours** le dernier semestre, même vide : à la rentrée
  c'est celui-là qu'on veut voir — les deux règles sont volontairement différentes. Le snapshot
  n'avance pas tant qu'une notification attendue n'a pas pu partir, sinon la note est marquée
  « déjà vue » et perdue.
- **Remember-tokens : deux échéances.** 30 jours absolus **et** 7 jours d'inactivité, comptés
  depuis `last_used_at`. Toute vue de ces jetons doit exposer `min(absolue, inactivité)` — n'afficher
  que l'absolue présentait comme actif un appareil déjà mort. Chaque `/api/refresh` fait tourner le
  jeton (`rotate_remember_token`), qui **reporte `created_at`** : recréer le jeton à neuf repoussait
  l'échéance absolue à chaque usage, et un appareil utilisé régulièrement ne redemandait jamais le
  mot de passe — alors que le CAS couvre aussi mail, VPN et ENT.
- **Refus du CAS.** Seul un message reconnu comme « identifiants incorrects » lève
  `InvalidCredentials` ; tout autre refus (compte verrouillé, mot de passe expiré, MFA) lève
  `CasAuthenticationRefused`. La distinction compte : le polling révoque **tous** les
  remember-tokens du compte sur `InvalidCredentials`.

## Architecture frontend

- **Système de jetons de couleur.** `src/index.css` définit les couleurs en variables CSS (triplets
  RGB) sur `:root` et `:root.dark` ; `tailwind.config.js` les expose sous des noms sémantiques
  (`bg-surface`, `text-muted`, `border-line`, `text-pos/neg/warn/sim`, `bg-accent-soft`…). Un
  composant s'écrit **une seule fois, sans préfixe `dark:`**. Ne pas introduire de couleur en dur ni
  de variante `dark:` : ajouter un jeton. Contraste vérifié WCAG AA (4.5:1) sur les deux thèmes.
- **Primitives partagées** dans `src/components/ui.tsx` : `Card`, `Panel`, `Collapsible`, `Notice`,
  `Button`, `NoteInput`, `Grade`, `Chevron`. Le repli utilise `grid-template-rows: 0fr → 1fr` — pas
  de `max-height` magique, qui tronquait le contenu long.
- **Hiérarchie des moyennes.** UE, module et évaluation affichent leur moyenne dans la même
  gouttière (`GRADE_COL`, largeur fixe alignée à droite), en taille décroissante. Avant, la
  moyenne d'un module était posée en bout d'une ligne de pastilles qui passait à la ligne selon
  la longueur du titre : la colonne ne tombait jamais deux fois au même endroit.
- **Deux pastilles par niveau**, toujours dans le même ordre : ce que pèse la ligne (ECTS/coef +
  poids), puis où elle se situe dans la promo (rang + moyenne de classe). Ne pas en rajouter une
  troisième — quatre pastilles débordaient sur une seconde ligne en laissant la dernière seule, et
  le rythme se cassait à chaque carte. Ne pas répéter non plus un poids déductible du niveau
  au-dessus (le `% gén.` d'un module se déduit de celui de son UE).
- **Couleur de simulation.** L'ocre (`sim`) ne s'applique qu'aux notes d'évaluation individuelles
  saisies par l'utilisateur. Les agrégats (moyennes d'UE, de module, générale) ne la portent
  jamais : leur état simulé passe par la bordure de carte et une pastille.
- **Rendu et saisie.** `UeTable` est mémoïsé avec un comparateur sur mesure
  (`overridesEqualForUe`) : `overrides` change d'identité à chaque caractère tapé, donc un
  `memo()` par défaut ne filtre rien et toutes les UE de la page sont re-rendues à chaque
  frappe. Même raison pour les `useCallback` de `useSimulation` — une fonction recréée à
  chaque rendu suffit à annuler la mémoïsation des enfants.
- **Poids du bundle.** Le chargement initial est le budget à surveiller (mobile, réseau IUT) :
  recharts n'est tiré que par la vue Graphiques (`lazy`), et la validation des réponses ScoDoc
  est écrite à la main dans `schemas.ts` plutôt que confiée à un validateur générique — deux
  formes à vérifier ne valaient pas 13 Ko gzippés sur le chemin critique.
- **Données** : React Query (`hooks/useReleveData.ts`) + double cache — `localStorage`
  (`offlineCache.ts`, best effort, avec version à incrémenter quand le format change) et le service
  worker. `USER_DATA_PREFIXES` est la source unique des préfixes à effacer à la déconnexion ;
  ajouter un nouveau préfixe de données utilisateur **là** et nulle part ailleurs, sinon les données
  d'un compte fuient vers le suivant sur un appareil partagé. La déconnexion (`logout()` dans
  `api.ts`) purge **quatre** couches, pas trois : à ces deux caches s'ajoutent la session serveur et
  l'abonnement push — laissé en place, il envoyait les notes du compte sortant au suivant.
- **Tests vitest.** Quatre fichiers : `simulator.test.ts`, `offlineCache.test.ts`, `api.test.ts`,
  `deviceLabel.test.ts`. Pas de jsdom — `localStorage`, `navigator` et `fetch` sont stubbés à la
  main dans chaque fichier, ce qui suffit à cette logique et évite ~10 Mo dans la CI. Les deux
  fichiers de purge/auth existent parce que ces chemins-là ont déjà cassé (fuite de données entre
  comptes, impasse au rechargement) : y ajouter un test plutôt que de vérifier à la main. Un test
  qui filtre avec la constante qu'il vérifie ne prouve rien — utiliser des valeurs en dur.
- **Ids de semestre.** ScoDoc renvoie `formsemestre_id` en nombre, tout le client le manipule en
  chaîne (valeur de `<select>`, segment d'URL, clé de cache et de requête). La normalisation — et le
  tri chronologique de la liste — se fait une seule fois, dans `normalizeSemestres` (`api.ts`) : ne
  pas rustiner les comparaisons au cas par cas.
- **Panne réseau ≠ session expirée.** `isNetworkFailure()` sépare les deux ; un `/api/me` qui échoue
  faute de réseau ne doit jamais déconnecter l'interface, sinon toute sortie de veille en zone mal
  couverte renvoie sur l'écran de connexion et fait perdre l'accès au cache hors-ligne.
- **Service worker** (`src/sw.ts`, stratégie `injectManifest`) : stale-while-revalidate sur
  `/api/semestres` et `/api/releve/*`, sauf `?refresh=true` qui doit toujours aller au réseau ;
  NetworkFirst sur la navigation avec repli sur l'`index.html` précaché ; gère `push`,
  `notificationclick`, `SKIP_WAITING` et `CLEAR_USER_CACHES`. Mise à jour en mode `prompt` : c'est
  `AppMenu` qui propose le bouton.
- **Défilement.** Ne jamais appeler `scrollIntoView` sur un élément d'une barre horizontale : il
  remonte tous les ancêtres scrollables, page comprise, et rend la page impossible à faire défiler.
  `SectionNav` applique le défilement au rail lui-même. Éviter aussi tout `w-full` qui déborde
  (le débordement horizontal transforme le défilement vertical en glissement diagonal sur mobile).
- **Simulation** (`simulator.ts`) : les min/max ne sont calculés qu'au niveau d'une évaluation
  individuelle — les agréger produirait des extrêmes fictifs.
  La moyenne d'une UE pondère chaque évaluation par `coef × poids[codeUE]` (formule ScoDoc) :
  en BUT, une même ressource alimente plusieurs UE avec des poids différents, voire nuls. D'où
  le paramètre `ueCode` de `ueAggregate`/`moduleAggregate` — l'omettre retombe sur `coef` seul,
  ce qui n'est correct que hors contexte d'UE (moyenne d'un module affichée pour elle-même).
- **Semestre pas encore démarré.** ScoDoc renvoie une moyenne `"00.00"` et un rang `"1 ex / 33"`
  pour un formsemestre créé mais sans aucune évaluation : affichés bruts, ils se lisent comme un
  vrai 0/20. `countEvaluations(releve) === 0` est le test qui gouverne cet état vide.
- `/preview/s5` et `/preview/s6` : page publique de prévisionnel BUT R&T, accessible sans session,
  donc testée avant tout écran d'authentification dans `App.tsx`.

## Déploiement

Image multi-étages : build Vite, puis runtime Python qui sert `/api` **et** `frontend/dist`. Le
Dockerfile installe manuellement l'intermédiaire TLS HARICA-GEANT (le portail ne l'envoie pas dans
sa poignée de main) et force `REQUESTS_CA_BUNDLE` sur le magasin système — sans quoi tout appel au
portail échoue en vérification de certificat. Un identifiant de build est calculé par hachage des
sources et injecté des deux côtés (`generatedBuild.ts`, `build_info.py`).

Variables d'environnement (`.env`) : `SECRET_KEY` (chiffrement des identifiants mémorisés),
`ADMIN_USERNAMES` (liste séparée par des virgules ouvrant `/api/admin/*`), et les réglages de
polling push (`PUSH_POLL_INTERVAL`, `PUSH_MAX_CONCURRENT_CHECKS`…).
