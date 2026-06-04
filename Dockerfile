# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

RUN apk add --no-cache python3 make g++

# Copy workspace manifests — good layer caching
COPY package.json yarn.lock ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY cli/package.json ./cli/

# Stub out desktop so yarn doesn't try to install Electron in Docker
RUN mkdir -p desktop && \
    echo '{"name":"@enzo-ai/desktop","version":"0.0.0","private":true}' > desktop/package.json

RUN yarn install --frozen-lockfile --ignore-engines

COPY server/ ./server/
COPY web/ ./web/
COPY cli/ ./cli/

RUN yarn workspace @enzo-ai/server build
RUN yarn workspace @enzo-ai/web build
RUN yarn workspace @enzo-ai/cli build
RUN npx ncc build cli/dist/index.js -o cli/dist/bundle -q


# ── Stage 2: Ollama binary ─────────────────────────────────────────────────────
# Copy directly from the official Ollama image — correct arch, no download needed.
FROM ollama/ollama:latest AS ollama


# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tini wget

# Ollama binary from official image (correct arch, always up to date)
COPY --from=ollama /usr/bin/ollama /usr/local/bin/ollama

# NestJS server bundle
COPY --from=builder /build/server/dist/bundle/index.js ./server.js

# Web UI (served as static files by the server at localhost:1616)
COPY --from=builder /build/web/dist ./web/dist

# CLI — available as `enzo-ai` inside the container
COPY --from=builder /build/cli/dist/bundle/index.js ./cli.js
RUN printf '#!/bin/sh\nexec node /app/cli.js "$@"\n' > /usr/local/bin/enzo-ai && \
    chmod +x /usr/local/bin/enzo-ai

# Native module (better-sqlite3 — compiled for this Node version/arch)
COPY --from=builder /build/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /build/node_modules/bindings ./node_modules/bindings
COPY --from=builder /build/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Startup script
COPY docker-start.sh /docker-start.sh
RUN chmod +x /docker-start.sh

# Persistent data — mount this volume to keep data between restarts
VOLUME /app/data

EXPOSE 1616
EXPOSE 11434

ENV ENZO_HOST=0.0.0.0
ENV ENZO_PORT=1616
ENV ENZO_DATA_DIR=/app/data
ENV ENZO_WEB_DIR=/app/web/dist

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/docker-start.sh"]
