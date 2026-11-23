# --- Build frontend ---
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Runtime ---
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/static DB_PATH=/data/app.db \
    PATH=/root/.local/bin:$PATH \
    DISABLE_AUTOUPDATER=1
WORKDIR /app

# tzdata so TZ=... works (the "Latest news" summaries are keyed by local day);
# curl for the Claude Code installer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
 && rm -rf /var/lib/apt/lists/*

# Claude Code CLI for the AI summaries. It authenticates with the
# CLAUDE_CODE_OAUTH_TOKEN env var (from `claude setup-token`), so it uses your
# Pro/Max subscription. Without the token, summaries fail and everything else works.
ARG CLAUDE_CODE_CHANNEL=stable
RUN curl -fsSL https://claude.ai/install.sh | bash -s "$CLAUDE_CODE_CHANNEL" \
 && claude --version

COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install --no-cache-dir .
COPY --from=frontend /frontend/dist ./static
RUN mkdir -p /data
EXPOSE 8080
# Fly.io defaults. docker-compose.yml overrides this for the tailnet deployment.
CMD ["uvicorn", "--factory", "app.main:create_app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "*"]
