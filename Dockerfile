# Stage 1: build the React frontend
FROM node:26-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Stage 2: FastAPI backend serving the built bundle
FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --uid 1000 --create-home app \
    && mkdir -p /data && chown app:app /data
COPY backend/ ./backend/
COPY --from=web /web/dist ./static/
# COPY preserves host file modes, which may not be world-readable.
RUN chmod -R a+rX /app
USER app
EXPOSE 8765
# Probe the PUBLIC auth endpoint: /api/state needs a session since the
# native login shipped — probing it would flap unhealthy (and trigger
# autoheal restart loops) whenever a login mode is enabled.
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s CMD \
  python3 -c "import urllib.request as u; u.urlopen('http://127.0.0.1:8765/api/auth', timeout=4)" || exit 1
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8765"]
