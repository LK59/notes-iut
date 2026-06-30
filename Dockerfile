FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN find . -type f ! -path './node_modules/*' ! -path './dist/*' \
    | sort \
    | xargs sha256sum \
    | sha256sum \
    | cut -c1-12 > /tmp/frontend_build_id \
    && printf "export const GENERATED_BUILD_ID = \"%s\";\n" "$(cat /tmp/frontend_build_id)" > src/generatedBuild.ts
RUN npm run build

FROM python:3.12-slim AS runtime
WORKDIR /app

# notes.iut-acy.univ-smb.fr ne renvoie pas le certificat intermédiaire HARICA-GEANT
# dans la poignée de main TLS (chaîne incomplète côté serveur) : les navigateurs le
# tolèrent (cache d'intermédiaires / AIA fetching) mais les clients HTTP standards non.
# On récupère et installe l'intermédiaire manquant pour que la chaîne se valide.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL http://crt.harica.gr/HARICA-GEANT-TLS-R1.cer -o /tmp/intermediate.der \
    && openssl x509 -inform der -in /tmp/intermediate.der -out /usr/local/share/ca-certificates/harica-geant-tls-r1.crt \
    && update-ca-certificates \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* /tmp/intermediate.der

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# requests utilise le bundle certifi (racines uniquement) par défaut, pas le magasin
# système : on le force explicitement à utiliser le magasin système mis à jour ci-dessus
# pour qu'il voie l'intermédiaire HARICA-GEANT qu'on vient d'y ajouter.
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
RUN find backend frontend/dist -type f \
    | sort \
    | xargs sha256sum \
    | sha256sum \
    | cut -c1-12 > /tmp/app_build_id \
    && python3 -c "from pathlib import Path; build=Path('/tmp/app_build_id').read_text().strip(); Path('backend/app/build_info.py').write_text(f'APP_BUILD_ID = {build!r}\\n')"

RUN useradd -u 1001 -m notesiut \
    && mkdir -p /app/data \
    && chown -R notesiut:notesiut /app
USER notesiut
VOLUME ["/app/data"]

EXPOSE 8000

# curl a été retiré ci-dessus : on utilise python3 (déjà présent, image slim) plutôt que de
# réinstaller un paquet juste pour le healthcheck. /api/health ne dépend d'aucune session ni
# appel réseau externe, donc ce test détecte un process bloqué (deadlock, thread figé), pas
# seulement un crash — ce que "restart: unless-stopped" seul ne couvre pas.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=3)" || exit 1

# --proxy-headers + --forwarded-allow-ips='*' : le conteneur n'est joignable que depuis le
# réseau docker interne (derrière nginx-proxy-manager, pas de port publié), donc on peut faire
# confiance à X-Forwarded-For pour récupérer la vraie IP cliente (utile pour le rate-limit login).
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
