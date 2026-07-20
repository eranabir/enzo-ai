import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { SettingsService } from "../settings/settings.service";
import { ChatsService } from "../chats/chats.service";
import { UsersService } from "../users/users.service";
import { AgentsService } from "../agents/agents.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { extractDocumentText } from "../chat/document-extract";

/** Telegram Bot API hard cap on file size we can fetch via getFile. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/** Placeholder key in the chat map for the chat created at connect time,
 *  before any real Telegram chat id is known. The first inbound chat adopts it. */
const PENDING_KEY = "__pending__";

/** Per-user settings keys — each user runs their own Telegram bot, with their
 *  own chats and memory. */
const K = {
  token:   (u: string) => `telegram_bot_token_${u}`,
  allowed: (u: string) => `telegram_allowed_ids_${u}`,
  enabled: (u: string) => `telegram_enabled_${u}`,
  chatMap: (u: string) => `telegram_chat_map_${u}`,
};

@Injectable()
export class TelegramService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);

  // ownerUserId → that user's live bot. One bot per user who connected one.
  private bots = new Map<string, { bot: Telegraf; username: string }>();

  // Injected from app.module after ChatService is wired up — avoids a circular
  // dependency between TelegramModule ↔ ChatModule.
  private runChat?: (
    userId: string,
    chatId: string,
    content: string,
  ) => Promise<string>;

  constructor(
    private readonly settings: SettingsService,
    private readonly convos: ChatsService,
    private readonly users: UsersService,
    private readonly agentsSvc: AgentsService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** Called by app.module after ChatService is available. Auto-starts every
   *  user who has Telegram enabled. */
  setRunner(
    fn: (userId: string, convoId: string, content: string) => Promise<string>,
  ) {
    // Note: bots are started separately via startAllEnabled() once the vault is
    // ready (see AppModule), so we don't auto-start here.
    this.runChat = fn;
  }

  // ── Public API (per user) ───────────────────────────────────────────────────

  /** Start a user's bot and return its verified username. */
  async start(userId: string, notify = false): Promise<{ username: string }> {
    if (!this.settings.isConnectionEnabled("telegram")) {
      throw new Error("Telegram is disabled by the administrator");
    }
    const token = this.settings.get(K.token(userId));
    if (!token) throw new Error("Bot token not configured");
    this.stop(userId);

    // Telegraf wraps every update handler in a 90s timeout by default and
    // silently aborts (no reply sent) if it's exceeded — too short for a local
    // model doing multiple sequential tool calls or a cold start. Disable it;
    // the handler naturally ends when the chat reply finishes streaming.
    const bot = new Telegraf(token, { handlerTimeout: Infinity });
    const me = await bot.telegram.getMe(); // verifies the token
    this.registerHandlers(userId, bot);
    bot.launch().catch((e) => this.logger.error(`Telegram bot crashed (user ${userId}): ${e.message}`));

    const username = me.username ?? me.first_name;
    this.bots.set(userId, { bot, username });
    this.settings.set(K.enabled(userId), "1");
    this.logger.log(`Telegram bot @${username} started for user ${userId}`);

    if (notify) {
      const allowedIds = this.settings.get(K.allowed(userId));
      for (const id of (allowedIds ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
        bot.telegram.sendMessage(id,
          `✅ *Enzo AI connected*\nBot @${username} is online and ready.\nSend me a message to start chatting!`,
          { parse_mode: "Markdown" },
        ).catch(() => this.logger.warn(`Could not notify Telegram user ${id} — they must /start the bot first`));
      }
    }

    return { username };
  }

  stop(userId: string): void {
    const entry = this.bots.get(userId);
    if (entry) {
      entry.bot.stop("manual");
      this.bots.delete(userId);
      this.logger.log(`Telegram bot stopped for user ${userId}`);
    }
    this.settings.set(K.enabled(userId), "0");
  }

  isRunning(userId: string): boolean {
    return this.bots.has(userId);
  }

  /** Stop every running bot (admin disabled the connection). Keeps per-user
   *  enabled flags so startAllEnabled() can restore them on re-enable. */
  stopAllRunning(): void {
    for (const [, entry] of this.bots) entry.bot.stop("admin-disabled");
    this.bots.clear();
    this.logger.log("All Telegram bots stopped (connection disabled by admin)");
  }

  /** Start bots for every user who has it enabled (admin re-enabled it). */
  startAllEnabled(): void {
    for (const u of this.users.listAll()) {
      if (this.settings.get(K.enabled(u.id)) === "1") {
        this.start(u.id).catch((e) => this.logger.error(`Telegram start failed for ${u.id}: ${e.message}`));
      }
    }
  }

  /** Persist a user's Telegram config (token/allowlist). */
  updateConfig(userId: string, cfg: { token?: string; allowedIds?: string }): void {
    if (cfg.allowedIds != null) this.settings.set(K.allowed(userId), String(cfg.allowedIds).trim());
    if (cfg.token?.trim()) this.settings.set(K.token(userId), cfg.token.trim());
  }

  /** Current config + status for a user (drives the Connections UI). */
  getStatus(userId: string) {
    return {
      available: this.settings.isConnectionEnabled("telegram"),
      enabled: this.isRunning(userId),
      username: this.bots.get(userId)?.username ?? null,
      token: this.settings.get(K.token(userId)) ? "••••••••" : null,
      allowedIds: this.settings.get(K.allowed(userId)) ?? "",
    };
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  private registerHandlers(ownerUserId: string, bot: Telegraf): void {
    bot.start((ctx) =>
      ctx.reply(
        "✅ *Connected to Enzo AI*\n\nI'm your private, locally-running AI assistant.\nJust send me a message and I'll reply — no data leaves your server.\n\nWhat can I help you with?",
        { parse_mode: "Markdown" },
      ),
    );

    bot.command("chatid", (ctx) =>
      ctx.reply(
        `📋 Chat ID: \`${ctx.chat.id}\`\n\nUse this ID in the Agents settings to link an agent to this chat.`,
        { parse_mode: "Markdown" },
      ),
    );

    bot.on(message("text"), async (ctx) => {
      const telegramUserId = String(ctx.from.id);
      const chatId         = String(ctx.chat.id);
      const isGroup        = ctx.chat.type === "group" || ctx.chat.type === "supergroup";
      const senderName     = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ")
                             || ctx.from.username || "User";
      const text           = ctx.message.text;

      const allowed = this.settings.get(K.allowed(ownerUserId));
      if (allowed) {
        const ids = allowed.split(",").map((s) => s.trim());
        if (!ids.includes(telegramUserId)) {
          await ctx.reply("⛔ You are not authorised to use this bot.");
          return;
        }
      }

      if (!this.runChat) {
        await ctx.reply("⚠️ Server not ready yet, please try again.");
        return;
      }

      await ctx.sendChatAction("typing");
      // Telegram's native "typing…" indicator is easy to miss (it's a small
      // subtitle under the chat name, and expires after ~5s), so also send an
      // actual visible message immediately — replaced with the real answer
      // (or the error) once it's ready, so there's never a stretch with zero
      // visible feedback while a reply is in flight.
      const statusMsg = await ctx.reply("🤔 Thinking…").catch(() => null);

      // Declared outside the try block so the catch handler can still save
      // the failure into the chat's own history — otherwise a mid-request
      // failure (e.g. Ollama's local model runtime crashing) leaves the user
      // seeing the "sorry" reply in Telegram itself but total silence in
      // EnzoAI's own mirrored view of the same conversation.
      let convoId: string | undefined;
      try {
        const chatTitle = isGroup
          ? (("title" in ctx.chat ? ctx.chat.title : null) ?? `Group ${chatId}`)
          : senderName;
        const linkedAgent = this.findAgentForChat(ownerUserId, chatId);
        const agentTitle = linkedAgent ? `${linkedAgent.emoji} ${linkedAgent.name}` : chatTitle;

        const created = this.getOrCreateChat(
          ownerUserId,
          chatId,
          linkedAgent ? agentTitle : chatTitle,
          linkedAgent?.id,
        );
        convoId = created.convoId;
        const userId = created.userId;

        const typingInterval = setInterval(() => ctx.sendChatAction("typing").catch(() => {}), 4000);
        let reply: string;
        try {
          reply = await this.runChat(userId, convoId, text);
        } finally {
          clearInterval(typingInterval);
        }

        const chunks = splitMessage(reply);
        const [first, ...rest] = chunks;
        if (statusMsg && first) {
          await ctx.telegram
            .editMessageText(ctx.chat.id, statusMsg.message_id, undefined, first, { parse_mode: "Markdown" })
            .catch(() => ctx.reply(first, { parse_mode: "Markdown" }));
        } else if (first) {
          await ctx.reply(first, { parse_mode: "Markdown" });
        }
        for (const chunk of rest) {
          await ctx.reply(chunk, { parse_mode: "Markdown" });
        }
      } catch (err) {
        this.logger.error("Failed to process message:", (err as Error).message);
        const errorReply = "⚠️ Something went wrong. Please try again.";
        if (convoId) this.convos.addMessage(convoId, "assistant", errorReply);
        if (statusMsg) {
          await ctx.telegram
            .editMessageText(ctx.chat.id, statusMsg.message_id, undefined, errorReply)
            .catch(() => ctx.reply(errorReply));
        } else {
          await ctx.reply(errorReply);
        }
      }
    });

    bot.on(message("document"), async (ctx) => {
      const telegramUserId = String(ctx.from.id);
      const chatId          = String(ctx.chat.id);

      const allowed = this.settings.get(K.allowed(ownerUserId));
      if (allowed) {
        const ids = allowed.split(",").map((s) => s.trim());
        if (!ids.includes(telegramUserId)) {
          await ctx.reply("⛔ You are not authorised to use this bot.");
          return;
        }
      }

      const linkedAgent = this.findAgentForChat(ownerUserId, chatId);
      if (!linkedAgent?.knowledge_base_id) {
        await ctx.reply(
          "📎 Got your file, but this chat isn't linked to an agent with a knowledge base.\n\n" +
          "Link this chat to an agent (Agents → Integrations → Telegram) and set that agent's knowledge base first.",
        );
        return;
      }

      const doc = ctx.message.document;
      if (doc.file_size && doc.file_size > MAX_DOCUMENT_BYTES) {
        await ctx.reply(`⚠️ "${doc.file_name ?? "File"}" is too large (max 20 MB).`);
        return;
      }

      await ctx.sendChatAction("upload_document");
      try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const res = await fetch(fileLink.href);
        if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const filename = doc.file_name ?? "document";

        const text = await extractDocumentText(buffer, doc.mime_type ?? "", filename);
        if (!text.trim()) {
          await ctx.reply(`⚠️ Couldn't find readable text in "${filename}" (it may be a scanned/image-only document).`);
          return;
        }

        const added = await this.knowledge.addDocument(linkedAgent.knowledge_base_id, ownerUserId, {
          title: filename,
          sourceType: "file",
          content: text,
          sourceRef: filename,
        });
        await ctx.reply(`✅ Added "${filename}" to ${linkedAgent.emoji} ${linkedAgent.name}'s knowledge base (${added.chunk_count} chunk${added.chunk_count === 1 ? "" : "s"}).`);
      } catch (err) {
        this.logger.error(`Telegram document ingestion failed: ${(err as Error).message}`);
        await ctx.reply(`⚠️ ${(err as Error).message || "Couldn't process that file."}`);
      }
    });

    bot.catch((err) => this.logger.error("Telegraf error:", err));
  }

  // ── Chat management (per user) ───────────────────────────────────────

  /** Create a fresh, clean chat on connect so it shows in the UI right
   *  away. Wipes any stale Telegram chats for this user first. Named after the
   *  bot until a real message arrives and renames it to the actual chat/group. */
  prepareChat(userId: string, botUsername?: string): void {
    this.deleteChat(userId);
    const convo = this.convos.create(userId, undefined, undefined, "telegram");
    this.convos.rename(convo.id, botUsername ? `@${botUsername}` : "Telegram");
    this.saveChatMap(userId, { [PENDING_KEY]: convo.id });
    this.logger.log(`Prepared clean Telegram chat ${convo.id} for user ${userId}`);
  }

  getOrCreateChat(ownerUserId: string, chatId: string, chatTitle: string, agentId?: string): { userId: string; convoId: string } {
    const map = this.loadChatMap(ownerUserId);

    if (!map[chatId]) {
      if (map[PENDING_KEY]) {
        const convoId = map[PENDING_KEY];
        delete map[PENDING_KEY];
        this.convos.rename(convoId, chatTitle);
        if (agentId) this.convos.setAgent(convoId, agentId);
        map[chatId] = convoId;
      } else {
        const convo = this.convos.create(ownerUserId, undefined, agentId, "telegram");
        this.convos.rename(convo.id, chatTitle);
        map[chatId] = convo.id;
      }
      this.saveChatMap(ownerUserId, map);
    }

    return { userId: ownerUserId, convoId: map[chatId] };
  }

  /** Relay a web-UI reply back to the Telegram chat backing a chat. */
  async sendToChat(userId: string, convoId: string, text: string): Promise<void> {
    const entry = this.bots.get(userId);
    if (!entry || !text.trim()) return;
    const map = this.loadChatMap(userId);
    const chatId = Object.keys(map).find((k) => k !== PENDING_KEY && map[k] === convoId);
    if (!chatId) return;
    for (const chunk of splitMessage(text)) {
      await entry.bot.telegram.sendMessage(chatId, chunk, { parse_mode: "Markdown" }).catch((e) =>
        this.logger.error(`Failed to relay to Telegram chat ${chatId}: ${e.message}`),
      );
    }
  }

  private findAgentForChat(ownerUserId: string, chatId: string) {
    const agents = this.agentsSvc.list(ownerUserId);
    return agents.find((a) => {
      if (!a.telegram_chat_ids) return false;
      return a.telegram_chat_ids.split(",").map((s) => s.trim()).includes(chatId);
    }) ?? null;
  }

  /** Proactively send an agent's scheduled result to its linked Telegram chats. */
  async notifyAgentResult(userId: string, agentTelegramChatIds: string, message: string): Promise<void> {
    const entry = this.bots.get(userId);
    if (!entry) return;
    const chatIds = agentTelegramChatIds.split(",").map((s) => s.trim()).filter(Boolean);
    for (const chatId of chatIds) {
      for (const chunk of splitMessage(message)) {
        await entry.bot.telegram.sendMessage(chatId, chunk, { parse_mode: "Markdown" }).catch((e) =>
          this.logger.error(`Failed to notify Telegram chat ${chatId}: ${e.message}`),
        );
      }
    }
  }

  /** Clear a user's saved Telegram config (token/allowlist). */
  clearConfig(userId: string): void {
    this.settings.set(K.token(userId), "");
    this.settings.set(K.allowed(userId), "");
  }

  /** Delete all of a user's Telegram chats (on disconnect/reconnect). */
  deleteChat(userId: string): void {
    const map = this.loadChatMap(userId);
    for (const convoId of Object.values(map)) {
      try { this.convos.delete(convoId); } catch { /* already gone */ }
    }
    this.settings.set(K.chatMap(userId), "{}");
    // Also sweep any orphaned chats tagged with this integration.
    try { this.convos.deleteByConnection(userId, "telegram"); } catch { /* ignore */ }
  }

  private loadChatMap(userId: string): Record<string, string> {
    const raw = this.settings.get(K.chatMap(userId));
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  private saveChatMap(userId: string, map: Record<string, string>): void {
    this.settings.set(K.chatMap(userId), JSON.stringify(map));
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onModuleDestroy() {
    for (const [, entry] of this.bots) entry.bot.stop("module-destroy");
  }
}

/** Split a long message into ≤4096-char chunks at newline boundaries. */
function splitMessage(text: string, limit = 4096): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) { chunks.push(remaining); break; }
    const cut = remaining.lastIndexOf("\n", limit);
    const pos = cut > 0 ? cut : limit;
    chunks.push(remaining.slice(0, pos));
    remaining = remaining.slice(pos).trimStart();
  }
  return chunks;
}
