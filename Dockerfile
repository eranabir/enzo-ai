# ── Stage 1: Build ────────────────────────────────────────────────────────────
# Debian-slim (glibc), not Alpine (musl) — the bundled Ollama binary below is
# glibc-linked, and better-sqlite3's native module must be compiled against the
# same libc as the runtime stage it ends up in, so both stages use the same base.
FROM node:20-bookworm-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

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
FROM node:20-bookworm-slim

WORKDIR /app

# ca-certificates is required for the bundled Ollama binary (a Go program) to
# verify TLS when pulling models from the registry — node:*-slim doesn't ship
# it, and unlike Node's fetch (which bundles its own CA list), Go's TLS client
# reads the OS trust store, so without this package every model pull fails
# with "x509: certificate signed by unknown authority".
RUN apt-get update && apt-get install -y --no-install-recommends tini wget ca-certificates && rm -rf /var/lib/apt/lists/*

# Ollama binary from official image (correct arch, always up to date). Kept at
# the same /usr/bin/ollama path as upstream — Ollama locates its runner
# relative to the binary's own directory, so the binary and /usr/lib/ollama
# (the actual inference engines: llama-server + backend .so files per CPU/GPU)
# must keep the same relative layout as the official image or the daemon
# starts and lists models fine but every chat request fails.
COPY --from=ollama /usr/bin/ollama /usr/bin/ollama
COPY --from=ollama /usr/lib/ollama /usr/lib/ollama

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

# License + third-party notices (Ollama is redistributed in this image)
COPY LICENSE THIRD_PARTY_NOTICES.md /app/

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

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/docker-start.sh"]
