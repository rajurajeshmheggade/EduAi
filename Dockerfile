# EduAI backend (FastAPI) as one container. Build context = repository root (needs backend/ and db/migrations/).
#   docker build -t eduai-api .
#   docker run -p 8000:8000 -e DATABASE_URL=postgresql://... -e JWT_SECRET=... eduai-api
# Used as-is by Render (render.yaml), Railway (railway.json), Fly, Azure Container Apps or any VM.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

# espeak-ng: free offline voice for the AI tutor when neither Kokoro nor a provider TTS deployment is configured.
RUN apt-get update \
 && apt-get install -y --no-install-recommends espeak-ng ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# pgserver (embedded dev Postgres) and pytest are dev-only. INSTALL_KOKORO=1 adds the offline neural voice
# (onnxruntime, ~150 MB more RAM at runtime; the model files still come from `python -m scripts.download_voice`).
ARG INSTALL_KOKORO=0
COPY backend/requirements.txt backend/requirements.txt
RUN set -eux; \
    grep -vE '^(pgserver|pytest)' backend/requirements.txt > /tmp/requirements.txt; \
    if [ "$INSTALL_KOKORO" != "1" ]; then sed -i '/^kokoro-onnx/d' /tmp/requirements.txt; fi; \
    pip install -r /tmp/requirements.txt

COPY db ./db
COPY backend ./backend

# Non-root; /app/.data holds local uploads (STORAGE_MODE=local) — mount a volume there on hosts that offer one.
RUN useradd --create-home --uid 10001 app \
 && mkdir -p /app/.data/storage \
 && chmod +x backend/start.sh \
 && chown -R app:app /app
USER app

WORKDIR /app/backend
# Attendance, timetable and report dates use the server's local date: keep the school's zone (override per deployment).
ENV ENVIRONMENT=production PORT=8000 TZ=Asia/Kolkata
EXPOSE 8000
CMD ["./start.sh"]
