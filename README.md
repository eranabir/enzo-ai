# ⬡ EnzoAI

**Your private, local-first AI assistant.** EnzoAI runs entirely on your own machine — conversations, memory and API keys never leave your device.

[![Release](https://img.shields.io/github/v/release/eranabir/enzo-ai)](https://github.com/eranabir/enzo-ai/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- 🧠 **Local AI** — runs models via [Ollama](https://ollama.com) with zero cloud dependency
- 🌐 **External providers** — connect OpenAI, Anthropic, and Google Gemini
- 💾 **Persistent memory** — automatically extracts facts from conversations and injects them into future chats
- 🤖 **Agents** — create custom AI assistants with tools, schedules and multi-platform delivery
- 🔧 **Built-in tools** — web search, file reading, git, calculator, and more
- 📸 **Image uploads** — send images to vision-capable models
- 💬 **Telegram** — chat with your AI via Telegram bot from any device
- 🎮 **Discord** — bring Enzo AI into your Discord server or DMs
- 💼 **Slack** — use Enzo AI inside your Slack workspace (Socket Mode — no public URL needed)
- 👥 **Multi-user** — each user has their own isolated conversations and memory
- 🖥️ **Desktop app** — Electron tray app with system tray, starts on login
- 🐳 **Docker** — deploy on a NAS or server (Ollama bundled — single container)
- ⌨️ **CLI** — terminal access to your AI

---

## Installation

### Desktop App (Windows / macOS / Linux)

Download the installer from the [latest release](https://github.com/eranabir/enzo-ai/releases/latest):

| Platform | File |
|---|---|
| Windows | `enzo-ai-windows-0.x.x.exe` |
| macOS (Intel) | `enzo-ai-macos-0.x.x-x64.dmg` |
| macOS (Apple Silicon) | `enzo-ai-macos-0.x.x-arm64.dmg` |
| Linux | `enzo-ai-linux-amd64.deb` |

**First launch:** A setup screen appears asking if you want CLI tools in your PATH. The AI server starts automatically and opens in your browser at `http://localhost:1616`.

> **macOS note:** If macOS blocks the app, right-click → Open, or run: `xattr -cr "/Applications/Enzo AI.app"`

---

### Docker (NAS / Server / Headless)

Ollama is bundled — run EnzoAI in a single container, no separate services needed:

```bash
docker run -d \
  -p 1616:1616 \
  -v enzo-data:/app/data \
  ghcr.io/eranabir/enzo-ai:latest
```

Open `http://your-server-ip:1616` from any browser on your network.

**With docker-compose:**

```bash
curl -O https://raw.githubusercontent.com/eranabir/enzo-ai/main/docker-compose.yml
docker compose up -d
```

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `ENZO_PORT` | `1616` | Web UI + API port |
| `ENZO_HOST` | `0.0.0.0` | Bind address |
| `ENZO_DATA_DIR` | `/app/data` | SQLite database + uploads + Ollama models |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Override to use an external Ollama |
| `ENZO_DEFAULT_MODEL` | `llama3.2:3b` | Default model for new chats |

**Point the CLI at a Docker/NAS server:**
```bash
enzo-ai config server http://your-nas-ip:1616
enzo-ai login
```

---

## Getting Started

1. **Create your profile** — first user becomes admin
2. **Add a model** — Admin Panel → Models → pull a local model or add external API key
3. **Start chatting** — pick a model in the header and type

---

## Web UI

- **Model picker** — switch models per conversation from the header
- **Memory toggle** — enable/disable long-term memory per conversation  
- **Image upload** — 📎 button appears for vision-capable models
- **Collapsible sidebar** — `‹` to collapse to icon rail, click icons to expand
- **Integration Chats** — Telegram/Discord/Slack conversations appear separately in sidebar
- **Empty state suggestions** — quick-start prompts when opening a new chat

---

## Agents

Create custom AI assistants with their own instructions, model, tools and schedule.

**Creating an agent:** Agents panel (🤖 button) → + New agent

- **Instructions** — personality, focus, constraints
- **Model** — choose from available models
- **Tools** — web search, files, git, calculator, etc.
- **Scheduled run** — cron schedule + prompt (runs automatically)
- **Integrations** — link to Telegram/Discord/Slack channels for delivery

**Sending scheduled results to a channel:**

1. Open the agent form → Integrations section → + Add
2. Select integration type (Telegram / Discord / Slack)
3. Enter the channel/chat ID
4. Enable the schedule

Results are sent to the linked channels automatically when the agent runs.

---

## Tools

Available tools (admin can enable/disable each in Admin Panel → Tools):

| Tool | What it does |
|---|---|
| `get_datetime` | Returns current date and time |
| `calculator` | Evaluates math expressions |
| `web_search` | Searches the web via DuckDuckGo |
| `read_url` | Fetches and reads a web page |
| `git` | Runs read-only git commands (status, log, diff, blame…) |

> Filesystem access (read/write files, list directories) is provided by the **Filesystem MCP connector** — add it under MCP Servers and choose the folder it's allowed to access.

---

## CLI

### Installation

The CLI is installed automatically during desktop app setup. For Docker/NAS, it's bundled inside the container.

### Commands

```bash
# Auth
enzo-ai login                    # sign in
enzo-ai logout                   # sign out
enzo-ai whoami                   # show current user

# Configuration
enzo-ai config show              # show current config
enzo-ai config server <url>      # set server URL (for Docker/NAS)

# Chatting
enzo-ai chat                     # interactive chat session
enzo-ai chat "your question"     # one-shot question
enzo-ai chat -c <id>             # resume a specific chat

# Conversations
enzo-ai chats                    # list recent chats

# Memory
enzo-ai memories                 # list memories
enzo-ai memories clear           # clear all memories

# Agents
enzo-ai agents                   # list agents
enzo-ai agents run <id>          # trigger an agent manually

# Tools
enzo-ai tools                    # list tools with status
enzo-ai tools enable <name>      # enable a tool (admin)
enzo-ai tools disable <name>     # disable a tool (admin)

# Integrations
enzo-ai integrations             # show Telegram/Discord/Slack connection status

# Status
enzo-ai status                   # server health, models, integrations
```

---

## Admin Panel

Access via profile menu → **Admin panel** (admin users only).

### Users
View, reset passwords, delete users.

### Models
- **Local AI**: pull/delete Ollama models, set default
- **External AI**: add OpenAI, Anthropic, Google API keys

### Tools
Toggle each tool on/off system-wide.

### Integrations

#### Telegram
1. Create bot via **@BotFather** → `/newbot` → copy token
2. Admin Panel → Integrations → Telegram → paste token → **Save & Connect**
3. Send `/chatid` to the bot in any chat to get its ID (for agent linking)
4. For group chats: @BotFather → Bot Settings → Group Privacy → **Disable**

#### Discord
1. [discord.com/developers/applications](https://discord.com/developers/applications) → New Application → Bot → copy token
2. Enable **Message Content Intent** (Bot tab → Privileged Gateway Intents)
3. OAuth2 → URL Generator → bot scope → invite to server
4. Admin Panel → Integrations → Discord → paste token → **Save & Connect**
5. @mention the bot in channels to chat

#### Slack
1. [api.slack.com/apps](https://api.slack.com/apps) → New App → From scratch
2. **Socket Mode** → Enable → create App-Level Token (`xapp-...`) with `connections:write`
3. **Event Subscriptions** → Enable → add bot events: `message.channels`, `message.im`
4. **OAuth & Permissions** → Bot Scopes: `chat:write`, `channels:history`, `im:history`
5. Install app to workspace → Bot Token (`xoxb-...`)
6. Admin Panel → Integrations → Slack → paste both tokens → **Save & Connect**
7. Invite bot to channels: `/invite @yourbot`

**All integrations:**
- Each chat/channel gets its own conversation in the EnzoAI sidebar
- Conversations auto-refresh every 4 seconds when viewed
- Auto-reconnect on server restart (silent — no notification spam)
- Link agents to channels for scheduled delivery

---

## Memory System

EnzoAI automatically extracts facts, preferences, decisions and work context from conversations and injects them into future chats. Toggle per conversation with the Memory button in the header.

```bash
enzo-ai memories          # view
enzo-ai memories clear    # clear all
```

---

## Development

```bash
# Install
yarn install
ollama pull llama3.2:3b

# Run dev servers
yarn dev

# Build
yarn build:all

# Build desktop
yarn workspace @enzo-ai/desktop dist:win    # Windows
yarn workspace @enzo-ai/desktop dist:mac    # macOS
yarn workspace @enzo-ai/desktop dist:linux  # Linux .deb
```

**Release:** `git tag v0.x.x && git push --tags` → GitHub Actions builds all platforms + Docker image.

---

## Architecture

```
desktop/     Electron tray — starts NestJS server, manages Ollama
server/      NestJS API — auth · chat · memory · agents · tools
             └ integrations: telegram · discord · slack
web/         Vite + React — web UI (served by NestJS in production)
cli/         Node.js CLI — terminal client
```

All data lives in `%APPDATA%/Enzo AI/` (desktop) or `/app/data` (Docker). No telemetry, no analytics.

---

## License

MIT © 2025 Enzo AI
