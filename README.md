# ⬡ EnzoAI

**Your private, local-first AI assistant.** EnzoAI runs entirely on your own machine — conversations, memory and API keys never leave your device.

[![Release](https://img.shields.io/github/v/release/eranabir/enzo-ai)](https://github.com/eranabir/enzo-ai/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- 🧠 **Local AI** — runs models via [Ollama](https://ollama.com) with zero cloud dependency
- 🌐 **External providers** — connect OpenAI, Anthropic, and Google Gemini
- 💾 **Persistent memory** — automatically extracts facts from conversations and injects them into future chats
- 🤖 **Agents** — create custom AI assistants with tools, schedules and Telegram delivery
- 🔧 **Built-in tools** — web search, file reading, git, calculator, and more
- 📸 **Image uploads** — send images to vision-capable models
- 💬 **Telegram integration** — chat with your AI from any device via Telegram bot
- 👥 **Multi-user** — each user has their own isolated conversations and memory
- 🖥️ **Desktop app** — Electron tray app with system tray, starts on login
- 🐳 **Docker support** — deploy on a NAS or server, access from any browser
- ⌨️ **CLI** — terminal access to your AI

---

## Installation

### Desktop App (Windows / macOS / Linux)

Download the installer for your platform from the [latest release](https://github.com/eranabir/enzo-ai/releases/latest):

| Platform | File |
|---|---|
| Windows | `enzo-ai-windows-0.x.x.exe` |
| macOS (Intel) | `enzo-ai-macos-0.x.x-x64.dmg` |
| macOS (Apple Silicon) | `enzo-ai-macos-0.x.x-arm64.dmg` |
| Linux | `enzo-ai-linux-amd64.deb` |

**First launch:** A setup screen appears asking if you want to also install the CLI tools. The AI server starts automatically and opens in your browser at `http://localhost:1616`.

> **macOS note:** If macOS blocks the app, right-click → Open, or run: `xattr -cr "/Applications/Enzo AI.app"`

---

### Docker (NAS / Server / Headless)

Run EnzoAI on a home server, NAS or VPS with a single command:

```bash
docker run -d \
  -p 1616:1616 \
  -v enzo-data:/app/data \
  ghcr.io/eranabir/enzo-ai:latest
```

Then open `http://your-server-ip:1616` from any browser on your network.

**With docker-compose** (recommended for NAS):

```bash
# Download the compose file
curl -O https://raw.githubusercontent.com/eranabir/enzo-ai/main/docker-compose.yml

# Start
docker compose up -d
```

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `ENZO_PORT` | `1616` | Web UI + API port |
| `ENZO_HOST` | `0.0.0.0` | Bind address (`127.0.0.1` for local only) |
| `ENZO_DATA_DIR` | `/app/data` | SQLite database + uploads + Ollama models |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama endpoint (set for external Ollama) |
| `ENZO_DEFAULT_MODEL` | `llama3.2:3b` | Default model for new chats |

---

## Getting Started

### 1. Create your profile

On first launch, register a user account. The first registered user becomes the **admin**. Fill in your name, expertise areas and preferences — EnzoAI uses this to personalise responses.

### 2. Add a model

**Local models (Ollama):**
Open Admin Panel → Models → pull a model (e.g. `llama3.2:3b`, `qwen2.5:14b`).

**External models:**
Admin Panel → Models → External AI → enter your API key for OpenAI, Anthropic, or Google Gemini. Models appear automatically in the model picker.

### 3. Start chatting

Select a model in the header and start a conversation. EnzoAI will remember what you discuss and use that memory in future chats.

---

## Web UI

### Chat

- **Model picker** — switch models per conversation from the header
- **Memory toggle** — enable/disable long-term memory per conversation
- **Image upload** — attach images to messages (vision-capable models only; 📎 appears when supported)
- **Conversation history** — all chats are saved and searchable in the sidebar

### Sidebar

The sidebar separates **Integration Chats** (from Telegram etc.) and **Local Chats**.

- Collapse with `‹` for a minimal icon rail
- Click `💬` in the collapsed rail to browse chats without expanding

---

## Agents

Agents are custom AI assistants with their own instructions, model, tools and optionally a schedule.

**Creating an agent:**
1. Click **Agents** in the sidebar
2. Click **+ New agent**
3. Fill in:
   - **Name** + emoji — how it appears in the sidebar
   - **Instructions** — personality, focus, constraints
   - **Model** — choose from your available models
   - **Tools** — give the agent access to web search, files, git, etc.
   - **Scheduled run** — optional cron schedule + prompt (runs automatically)
   - **Integrations** — link to a Telegram chat (click `+Add` to add a chat ID)

**Starting a chat with an agent:**
From the agents list, click the ▶ play button. The agent's instructions shape every response in that conversation.

**Scheduled agents:**
Agents with a schedule run automatically (e.g. daily at 8am) and save results to your memory. If linked to a Telegram chat, results are sent there automatically.

---

## Tools

Tools let agents interact with the outside world. The admin can enable/disable each tool in **Admin Panel → Tools**.

| Tool | What it does |
|---|---|
| `get_datetime` | Returns current date and time |
| `calculator` | Evaluates math expressions safely |
| `web_search` | Searches the web via DuckDuckGo |
| `read_url` | Fetches and reads a web page |
| `read_file` | Reads a file from the local machine |
| `list_directory` | Lists files in a directory |
| `git` | Runs read-only git commands (status, log, diff, blame…) |

**How tools work:** The LLM decides when to call a tool, the server executes it and injects the result, then the LLM generates a final response. Up to 5 tool rounds per message.

---

## CLI

The CLI lets you interact with EnzoAI from any terminal.

### Installation

The CLI is installed automatically if you choose it during the desktop app setup. It's also bundled inside the Docker container.

**Pointing the CLI at a remote server** (Docker / NAS):
```bash
enzo-ai config server http://your-nas-ip:1616
enzo-ai login
```

### Commands

```bash
# Authentication
enzo-ai login                    # sign in
enzo-ai logout                   # sign out
enzo-ai whoami                   # show current user

# Configuration
enzo-ai config show              # show current config
enzo-ai config server <url>      # set server URL (for remote/Docker)

# Chatting
enzo-ai chat                     # interactive chat session
enzo-ai chat "your question"     # one-shot question
enzo-ai chat -c <id>             # resume a specific chat

# Conversations
enzo-ai chats                    # list recent chats

# Memory
enzo-ai memories                 # list your stored memories
enzo-ai memories clear           # clear all memories

# Agents
enzo-ai agents                   # list your agents
enzo-ai agents run <id>          # trigger an agent manually

# Tools
enzo-ai tools                    # list all tools with status
enzo-ai tools enable <name>      # enable a tool (admin)
enzo-ai tools disable <name>     # disable a tool (admin)

# Status
enzo-ai status                   # server health, models, session info
```

---

## Admin Panel

Access via the profile menu → **Admin panel** (admin users only).

### Users

- View all registered users
- Reset passwords
- Delete users

### Models

**Local AI (Ollama):**
- View installed models with size
- Pull new models (streams download progress)
- Set the default model
- Delete models

**External AI:**
- Add API keys for OpenAI, Anthropic, Google
- Available models appear automatically in the model picker

### Tools

Toggle each tool on/off system-wide. Disabled tools cannot be used by any agent even if selected during agent creation.

### Integrations

Configure external service connections. Currently available: **Telegram**.

### Danger

- **Reset all data** — wipes all users, chats and settings (requires typing "reset")

---

## Telegram Integration

Connect EnzoAI to Telegram so you can chat from your phone or share the bot with family.

### Setup

1. Open Telegram → search for **@BotFather** → `/newbot` → follow prompts → copy the token
2. In EnzoAI: **Admin Panel → Integrations → Telegram**
3. Paste the token → click **Save & Connect**
4. You'll see `✅ Bot @yourbot is live`

### Finding your chat ID

To link an agent to a Telegram group, send `/chatid` to the bot in that group. Copy the ID it returns and paste it into the agent's Integrations field.

### Group chat

1. Create a Telegram group
2. Add your bot to the group
3. In @BotFather: **Bot Settings → Group Privacy → Disable** (so the bot sees all messages)
4. Everyone in the group can now chat with the AI

Each Telegram chat (group or DM) gets its own isolated conversation visible in the EnzoAI web sidebar under **Integration Chats**.

### Linking an agent to Telegram

In the agent form → **Integrations** section → `+ Add` → paste the chat ID.

The agent's scheduled runs will automatically send results to that chat. Messages in the chat will be handled by the agent (using its instructions and tools).

---

## Memory System

EnzoAI automatically extracts and stores facts about you from conversations:

- **Facts** — things that are true about you
- **Preferences** — how you like things done
- **Decisions** — choices you've made
- **Work context** — current projects and focus areas

These memories are injected into the system prompt of future conversations so EnzoAI always has context about you, even in new chats.

**Managing memory:**
- Toggle memory on/off per conversation (Memory button in the header)
- View memories: `enzo-ai memories` or Admin Panel → your profile
- Clear memories: `enzo-ai memories clear`

---

## Development

### Prerequisites

- Node.js 20+
- Yarn 1.x — `npm i -g yarn`
- Ollama — install from [ollama.com](https://ollama.com)

### Running locally

```bash
# Install dependencies
yarn install

# Pull a model
ollama pull llama3.2:3b

# Start dev servers (NestJS + Vite HMR)
yarn dev
```

Web UI: `http://localhost:5310` — Dev server: `http://localhost:1616`

### Building

```bash
yarn build:all          # compile all TypeScript
yarn workspace @enzo-ai/desktop dist:win    # Windows installer
yarn workspace @enzo-ai/desktop dist:mac    # macOS DMG
yarn workspace @enzo-ai/desktop dist:linux  # Linux .deb
```

### Releasing

```bash
git tag v0.x.x
git push --tags
# GitHub Actions builds all platform installers + Docker image automatically
```

---

## Architecture

```
desktop/   Electron tray app — starts server, manages Ollama, shows tray icon
server/    NestJS API — auth · chat · memory · agents · tools · telegram
web/       Vite + React + Tailwind — the web UI (served by NestJS in production)
cli/       Node.js CLI — terminal client
```

**Data:** All data lives in `%APPDATA%/Enzo AI/` (desktop) or `/app/data` (Docker) — a portable SQLite database you can back up.

**Privacy:** No telemetry, no analytics, no data leaves your machine unless you configure an external provider (OpenAI etc.) and explicitly use it.

---

## License

MIT © 2025 Enzo AI
