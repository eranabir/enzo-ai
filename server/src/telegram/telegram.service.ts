import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { SettingsService } from "../settings/settings.service";
import { ConversationsService } from "../conversations/conversations.service";
import { UsersService } from "../users/users.service";
import { AgentsService } from "../agents/agents.service";

/** Placeholder key in the chat map for the conversation created at connect time,
 *  before any real Telegram chat id is known. The first inbound chat adopts it. */
const PENDING_KEY = "__pending__";

/** Per-user settings keys — each user runs their own Telegram bot, with their
 *  own conversations and memory. */
const K = {
  token:   (u: string) => `telegram_bot_token_${u}`,
  allowed: (u: string) => `telegram_allowed_ids_${u}`,
  model:   (u: string) => `telegram_model_${u}`,
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
    conversationId: string,
    content: string,
    model: string | undefined,
  ) => Promise<string>;

  constructor(
    private readonly settings: SettingsService,
    private readonly convos: ConversationsService,
    private readonly users: UsersService,
    private readonly agentsSvc: AgentsService,
  ) {}

  /** Called by app.module after ChatService is available. Auto-starts every
   *  user who has Telegram enabled. */
  setRunner(
    fn: (userId: string, convoId: string, content: string, model?: string) => Promise<string>,
  ) {
    this.runChat = fn;
    for (const u of this.users.listAll()) {
      if (this.settings.get(K.enabled(u.id)) === "1") {
        this.start(u.id).catch((e) => this.logger.error(`Telegram auto-start failed for ${u.id}: ${e.message}`));
      }
    }
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

    const bot = new Telegraf(token);
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

  /** Persist a user's Telegram config (token/allowlist/model). */
  updateConfig(userId: string, cfg: { token?: string; allowedIds?: string; model?: string }): void {
    if (cfg.allowedIds != null) this.settings.set(K.allowed(userId), String(cfg.allowedIds).trim());
    if (cfg.model != null) this.settings.set(K.model(userId), String(cfg.model).trim());
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
      model: this.settings.get(K.model(userId)) ?? "",
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

      try {
        const chatTitle = isGroup
          ? (("title" in ctx.chat ? ctx.chat.title : null) ?? `Group ${chatId}`)
          : senderName;
        const linkedAgent = this.findAgentForChat(ownerUserId, chatId);
        const agentTitle = linkedAgent ? `${linkedAgent.emoji} ${linkedAgent.name}` : chatTitle;

        const { userId, convoId } = this.getOrCreateChatConversation(
          ownerUserId,
          chatId,
          linkedAgent ? agentTitle : chatTitle,
          linkedAgent?.id,
        );
        const model = this.settings.get(K.model(ownerUserId)) ?? undefined;

        const typingInterval = setInterval(() => ctx.sendChatAction("typing").catch(() => {}), 4000);
        let reply: string;
        try {
          reply = await this.runChat(userId, convoId, text, model);
        } finally {
          clearInterval(typingInterval);
        }

        for (const chunk of splitMessage(reply)) {
          await ctx.reply(chunk, { parse_mode: "Markdown" });
        }
      } catch (err) {
        this.logger.error("Failed to process message:", (err as Error).message);
        await ctx.reply("⚠️ Something went wrong. Please try again.");
      }
    });

    bot.catch((err) => this.logger.error("Telegraf error:", err));
  }

  // ── Conversation management (per user) ───────────────────────────────────────

  /** Create a fresh, clean conversation on connect so it shows in the UI right
   *  away. Wipes any stale Telegram conversations for this user first. */
  prepareConversation(userId: string): void {
    this.deleteConversation(userId);
    const convo = this.convos.create(userId, undefined, undefined, "telegram");
    this.convos.rename(convo.id, "Telegram");
    this.saveChatMap(userId, { [PENDING_KEY]: convo.id });
    this.logger.log(`Prepared clean Telegram conversation ${convo.id} for user ${userId}`);
  }

  getOrCreateChatConversation(ownerUserId: string, chatId: string, chatTitle: string, agentId?: string): { userId: string; convoId: string } {
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

  /** Relay a web-UI reply back to the Telegram chat backing a conversation. */
  async sendToConversation(userId: string, convoId: string, text: string): Promise<void> {
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

  /** Clear a user's saved Telegram config (token/allowlist/model). */
  clearConfig(userId: string): void {
    this.settings.set(K.token(userId), "");
    this.settings.set(K.allowed(userId), "");
    this.settings.set(K.model(userId), "");
  }

  /** Delete all of a user's Telegram conversations (on disconnect/reconnect). */
  deleteConversation(userId: string): void {
    const map = this.loadChatMap(userId);
    for (const convoId of Object.values(map)) {
      try { this.convos.delete(convoId); } catch { /* already gone */ }
    }
    this.settings.set(K.chatMap(userId), "{}");
    // Also sweep any orphaned conversations tagged with this integration.
    try { this.convos.deleteByIntegration(userId, "telegram"); } catch { /* ignore */ }
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
