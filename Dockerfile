FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
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

RUN useradd -u 1001 -m notesiut \
    && mkdir -p /app/data \
    && chown -R notesiut:notesiut /app
USER notesiut
VOLUME ["/app/data"]

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--app-dir", "backend", "--host", "0.0.0.0", "--port", "8000"]
