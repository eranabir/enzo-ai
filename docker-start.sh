#!/bin/sh
# Enzo AI startup script — runs inside the container
# Starts Ollama (if bundled and no external OLLAMA_URL set), then the NestJS server

set -e

OLLAMA_BIN="/usr/bin/ollama"
INTERNAL_OLLAMA_URL="http://127.0.0.1:11434"

# If an external Ollama URL is provided, skip the bundled one
if [ -n "$OLLAMA_URL" ] && [ "$OLLAMA_URL" != "$INTERNAL_OLLAMA_URL" ]; then
  echo "[enzo-ai] Using external Ollama at $OLLAMA_URL"
else
  # Start bundled Ollama in the background
  export OLLAMA_URL="$INTERNAL_OLLAMA_URL"
  export OLLAMA_HOST="0.0.0.0:11434"
  export OLLAMA_MODELS="${OLLAMA_MODELS:-/app/data/ollama}"

  echo "[enzo-ai] Starting Ollama..."
  "$OLLAMA_BIN" serve &
  OLLAMA_PID=$!

  # Wait for Ollama to be ready (up to 30s)
  i=0
  until wget -qO- http://127.0.0.1:11434/api/tags > /dev/null 2>&1; do
    i=$((i + 1))
    if [ $i -ge 30 ]; then
      echo "[enzo-ai] WARNING: Ollama did not start in time, continuing anyway"
      break
    fi
    sleep 1
  done
  echo "[enzo-ai] Ollama ready"
fi

# Start the NestJS server (foreground — tini PID 1 supervises it)
echo "[enzo-ai] Starting server on :${ENZO_PORT:-1616}..."
exec node /app/server.js
