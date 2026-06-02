# Enzo

A self-hosted, **local-first AI chat** experience. Enzo runs models on your own
machine — your conversations and memory never leave your computer.

## What's here (MVP)

- **Local accounts** — register/login screen with a profile picker, password
  (scrypt-hashed) and optional PIN. Multiple users on one machine, each with
  their own isolated chats.
- **Personalised AI** — each user's onboarding profile ("about you" + "how
  should Enzo respond") is injected into their system prompt, so Enzo has
  context about who it's talking to.
- **Chat UI** — Vite + React + Tailwind, streaming responses, conversation history.
- **Local engine** — a NestJS backend that proxies to your local models and
  persists everything to **SQLite** on disk.
- **Local models via Ollama** — installed as a managed dependency.
- **Model switching** — pick any installed model from the header.
- **Provider abstraction** — external models (OpenAI/Anthropic, etc.) plug into
  the same `ChatProvider` interface later without touching the UI.

## Architecture

```
web/    Vite + React + Tailwind UI →  calls /api/* (proxied to the engine)
server/ NestJS engine              →  modules: auth · users · chat · conversations · models · llm
        └ auth/ (scrypt + session tokens, AuthGuard scopes data per user)
        └ llm/  (ollama today, external providers later)
        └ SQLite (users · conversations · memory) in ./data
Ollama  local model daemon         →  http://127.0.0.1:11434
```

The NestJS engine is organized into modules: `LlmModule` (the provider registry
+ Ollama provider), `ConversationsModule` (SQLite-backed memory), `ChatModule`
(streaming + persistence), and `ModelsModule` (list/status/pull). Dependency
injection wires them together, so adding an external provider is a new
`@Injectable` registered in `LlmService`.

The "server" is a **local background process**, not a cloud server. It exists so
that (1) external API keys never live in the browser, (2) memory is a real,
portable SQLite file rather than fragile browser storage, and (3) the UI talks
to one clean interface regardless of which model backend answers.

## Requirements

- [Node.js](https://nodejs.org) 20+
- [Yarn](https://classic.yarnpkg.com) 1.x (Classic) — `npm i -g yarn`
- [Ollama](https://ollama.com) (the installer/scripts set this up)

## Getting started

```powershell
# 1. Install dependencies (Yarn workspaces)
yarn install

# 2. Make sure Ollama is running and pull the default model
ollama pull llama3.2:3b

# 3. Run the UI + engine together
yarn dev
```

Then open the URL Vite prints (http://localhost:5310).

## Configuration

Environment variables (all optional):

| Var                   | Default                  | Purpose                      |
| --------------------- | ------------------------ | ---------------------------- |
| `ENZO_PORT`           | `4310`                   | Engine port                  |
| `ENZO_DATA_DIR`       | `./data`                 | Where SQLite + memory live   |
| `OLLAMA_URL`          | `http://127.0.0.1:11434` | Local Ollama API             |
| `ENZO_DEFAULT_MODEL`  | `llama3.2:3b`            | Default model for new chats  |

## Roadmap

- [ ] External providers (OpenAI / Anthropic) via the existing provider interface
- [ ] Long-term semantic memory (embeddings + vector search over past chats)
- [ ] In-app model download UI (the `/api/models/pull` endpoint already streams progress)
- [ ] Package as a desktop app (Electron/Tauri) with a one-click installer
