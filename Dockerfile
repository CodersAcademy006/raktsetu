# Single-container deployment: Temporal dev server (SQLite-persisted),
# Ollama serving Gemma, the Temporal worker and the API. Built for Hugging
# Face Spaces (port 7860, uid 1000) but runs anywhere Docker does. For a
# multi-instance production setup, point TEMPORAL_* at Temporal Cloud and
# OLLAMA_URL at a dedicated model server instead.
FROM ollama/ollama:latest AS ollama

FROM node:22-bookworm-slim
ARG GEMMA_MODEL=gemma3:4b
ENV GEMMA_MODEL=${GEMMA_MODEL} \
    OLLAMA_MODELS=/opt/ollama/models \
    OLLAMA_HOST=127.0.0.1:11434 \
    OLLAMA_URL=http://127.0.0.1:11434 \
    TEMPORAL_ADDRESS=127.0.0.1:7233 \
    PORT=7860 \
    NODE_ENV=production \
    HOME=/home/user

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ollama /usr/bin/ollama /usr/bin/ollama
COPY --from=ollama /usr/lib/ollama /usr/lib/ollama

RUN curl -fsSL "https://temporal.download/cli/archive/latest?platform=linux&arch=amd64" -o /tmp/temporal.tgz \
    && tar -xzf /tmp/temporal.tgz -C /usr/local/bin temporal \
    && rm /tmp/temporal.tgz && temporal --version

# Bake the model into the image so cold starts don't download 3 GB.
RUN mkdir -p "$OLLAMA_MODELS" && (ollama serve >/tmp/ollama-build.log 2>&1 &) \
    && for i in $(seq 1 30); do curl -sf "$OLLAMA_URL/api/tags" >/dev/null && break; sleep 1; done \
    && ollama pull "$GEMMA_MODEL"

RUN useradd -m -u 1000 user 2>/dev/null || true
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY apps ./apps
COPY scripts ./scripts
COPY start.sh ./
RUN chmod +x start.sh && chown -R 1000:1000 /app "$OLLAMA_MODELS"

USER 1000
EXPOSE 7860
CMD ["./start.sh"]
