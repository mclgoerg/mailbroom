# Stage 1: build the React frontend
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Stage 2: FastAPI backend serving the built bundle
FROM python:3.13-slim@sha256:7c61056e61ac89e852de05f3dc6fa51a6dd2181797bceed46aa725dd7cb2cd3b
WORKDIR /app
COPY backend/requirements.txt ./
# pip is build-time only: removing it (and its vendored msgpack/
# setuptools copies) from the runtime image shrinks the attack surface
# and keeps image CVE scanners quiet about libraries the app never runs.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y pip \
    && rm -rf /usr/local/lib/python3.13/site-packages/setuptools* \
              /usr/local/lib/python3.13/ensurepip \
    && useradd --uid 1000 --create-home app \
    && mkdir -p /data && chown app:app /data
COPY backend/ ./backend/
COPY --from=web /web/dist ./static/
# COPY preserves host file modes, which may not be world-readable.
RUN chmod -R a+rX /app
USER app
EXPOSE 8765
# Probe the PUBLIC auth endpoint: /api/state needs a session since the
# native login shipped - probing it would flap unhealthy (and trigger
# autoheal restart loops) whenever a login mode is enabled.
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s CMD \
  python3 -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8765/api/auth', timeout=4)" || exit 1
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8765"]
