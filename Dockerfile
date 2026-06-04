# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copy workspace manifests first for better layer caching
COPY package.json yarn.lock ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY cli/package.json ./cli/

# Stub out desktop + installer so yarn doesn't try to install Electron
RUN echo '{"name":"@enzo-ai/desktop","version":"0.0.0","private":true}' > desktop/package.json
RUN echo '{"name":"@enzo-ai/installer","version":"0.0.0","private":true}' > installer/package.json

RUN yarn install --frozen-lockfile --ignore-engines

# Copy source
COPY server/ ./server/
COPY web/ ./web/
COPY cli/ ./cli/

# Build server (TypeScript → ncc bundle)
RUN yarn workspace @enzo-ai/server build

# Build web UI (served by NestJS as static files)
RUN yarn workspace @enzo-ai/web build

# Bundle CLI with ncc
RUN yarn workspace @enzo-ai/cli build
RUN npx ncc build cli/dist/index.js -o cli/dist/bundle -q


# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Install better-sqlite3 runtime deps
RUN apk add --no-cache tini

# Server bundle (single JS file from ncc)
COPY --from=builder /build/server/dist/bundle/index.js ./server.js

# Web UI dist (served as static files by the server)
COPY --from=builder /build/web/dist ./web/dist

# CLI binary bundle (exec into container: docker exec enzo-ai node /app/cli.js ...)
COPY --from=builder /build/cli/dist/bundle/index.js ./cli.js
RUN echo '#!/bin/sh\nexec node /app/cli.js "$@"' > /usr/local/bin/enzo-ai && chmod +x /usr/local/bin/enzo-ai

# Native module — better-sqlite3 must be compiled for this Node version/arch
COPY --from=builder /build/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /build/node_modules/bindings ./node_modules/bindings
COPY --from=builder /build/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Persistent data volume (SQLite DB, uploads, master.key)
VOLUME /app/data

EXPOSE 1616

ENV ENZO_HOST=0.0.0.0
ENV ENZO_PORT=1616
ENV ENZO_DATA_DIR=/app/data
ENV ENZO_WEB_DIR=/app/web/dist
# OLLAMA_URL is set in docker-compose to point at the ollama sidecar

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
