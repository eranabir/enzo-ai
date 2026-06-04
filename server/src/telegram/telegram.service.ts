import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { SettingsService } from "../settings/settings.service";
import { ConversationsService } from "../conversations/conversations.service";
import { UsersService } from "../users/users.service";
import { AgentsService } from "../agents/agents.service";


@Injectable()
export class TelegramService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf | null = null;

  // Injected lazily from main.ts after ChatService is wired up — avoids
  // circular dependency between TelegramModule ↔ ChatModule.
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

  /** Called by TelegramModule after ChatService is available. */
  setRunner(
    fn: (userId: string, convoId: string, content: string, model?: string) => Promise<string>,
  ) {
    this.runChat = fn;
    // Auto-start if already configured
    if (this.settings.get("telegram_enabled") === "1") {
      this.start().catch((e) => this.logger.error("Auto-start failed:", e.message));
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Start the bot and return the verified bot username.
   *  @param notify - send "bot is online" message to allowed users (only on explicit connect, not auto-restart)
   */
  async start(notify = false): Promise<{ username: string }> {
    const token = this.settings.get("telegram_bot_token");
    if (!token) throw new Error("Bot token not configured");
    if (this.bot) this.stop();

    this.bot = new Telegraf(token);

    // Verify the token is valid and get the bot info before launching
    const me = await this.bot.telegram.getMe();

    this.registerHandlers();

    // Long polling — reaches out to Telegram, no public URL needed
    this.bot.launch().catch((e) => this.logger.error("Bot crashed:", e.message));
    this.settings.set("telegram_enabled", "1");
    this.logger.log(`Telegram bot @${me.username} started`);

    // Notify allowed users that the bot is online (only on explicit connect)
    const allowedIds = this.settings.get("telegram_allowed_ids");
    if (notify && allowedIds) {
      const ids = allowedIds.split(",").map((s) => s.trim()).filter(Boolean);
      for (const id of ids) {
        this.bot.telegram.sendMessage(id,
          `✅ *Enzo AI connected*\nBot @${me.username ?? me.first_name} is online and ready.\nSend me a message to start chatting!`,
          { parse_mode: "Markdown" }
        ).catch(() => {
          // User may not have messaged the bot yet — can't initiate without a prior chat
          this.logger.warn(`Could not notify Telegram user ${id} — they need to /start the bot first`);
        });
      }
    }

    return { username: me.username ?? me.first_name };
  }

  stop(): void {
    this.bot?.stop("manual");
    this.bot = null;
    this.settings.set("telegram_enabled", "0");
    this.logger.log("Telegram bot stopped");
  }

  isRunning(): boolean {
    return this.bot !== null;
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  private registerHandlers(): void {
    if (!this.bot) return;

    this.bot.start((ctx) =>
      ctx.reply(
        "✅ *Connected to Enzo AI*\n\nI'm your private, locally-running AI assistant.\nJust send me a message and I'll reply — no data leaves your server.\n\nWhat can I help you with?",
        { parse_mode: "Markdown" }
      )
    );

    // /chatid — returns the current chat's ID so users can link agents to it
    this.bot.command("chatid", (ctx) =>
      ctx.reply(
        `📋 Chat ID: \`${ctx.chat.id}\`\n\nUse this ID in the Agents settings to link an agent to this chat.`,
        { parse_mode: "Markdown" }
      )
    );

    this.bot.on(message("text"), async (ctx) => {
      const telegramUserId = String(ctx.from.id);
      const chatId         = String(ctx.chat.id);
      const isGroup        = ctx.chat.type === "group" || ctx.chat.type === "supergroup";
      const senderName     = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ")
                             || ctx.from.username || "User";
      const rawText        = ctx.message.text;
      // In groups, prefix message with sender name so the AI knows who is speaking
      const text           = isGroup ? `[${senderName}]: ${rawText}` : rawText;

      // Check allowlist (if configured)
      const allowed = this.settings.get("telegram_allowed_ids");
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

      // Show typing indicator
      await ctx.sendChatAction("typing");

      try {
        // Chat title: group name for groups, sender name for DMs
        const chatTitle = isGroup
          ? (("title" in ctx.chat ? ctx.chat.title : null) ?? `Group ${chatId}`)
          : senderName;
        // Check if any agent is linked to this Telegram chat
        const linkedAgent = this.findAgentForChat(chatId);
        const agentTitle = linkedAgent ? `${linkedAgent.emoji} ${linkedAgent.name}` : chatTitle;

        const { userId, convoId } = this.getOrCreateChatConversation(
          chatId,
          linkedAgent ? agentTitle : chatTitle,
          linkedAgent?.id,
        );
        const model = this.settings.get("telegram_model") ?? undefined;

        // Keep sending "typing" every 4s while the LLM processes
        const typingInterval = setInterval(() => ctx.sendChatAction("typing").catch(() => {}), 4000);
        let reply: string;
        try {
          reply = await this.runChat(userId, convoId, text, model);
        } finally {
          clearInterval(typingInterval);
        }

        // Telegram has a 4096 char limit — split if needed
        for (const chunk of splitMessage(reply)) {
          await ctx.reply(chunk, { parse_mode: "Markdown" });
        }
      } catch (err) {
        this.logger.error("Failed to process message:", (err as Error).message);
        await ctx.reply("⚠️ Something went wrong. Please try again.");
      }
    });

    this.bot.catch((err) => {
      this.logger.error("Telegraf error:", err);
    });
  }

  // ── Conversation management ────────────────────────────────────────────────

  /**
   * Get or create a conversation for a Telegram chat (DM or group).
   * One conversation per chat ID:
   *   - DM → one conversation per person
   *   - Group → one shared conversation for the whole group
   */
  getOrCreateChatConversation(chatId: string, chatTitle: string, agentId?: string): { userId: string; convoId: string } {
    const botUser = this.users.listAll().find((u) => u.role === "admin");
    if (!botUser) throw new Error("No admin user found to run the bot as");

    const map = this.loadChatMap();

    if (!map[chatId]) {
      const convo = this.convos.create(botUser.id, undefined, agentId, "telegram");
      this.convos.rename(convo.id, chatTitle);
      map[chatId] = convo.id;
      this.saveChatMap(map);
    }

    return { userId: botUser.id, convoId: map[chatId] };
  }

  /** Find an agent that has this Telegram chat ID in its telegram_chat_ids. */
  private findAgentForChat(chatId: string) {
    const botUser = this.users.listAll().find((u) => u.role === "admin");
    if (!botUser) return null;
    const agents = this.agentsSvc.list(botUser.id);
    return agents.find((a) => {
      if (!a.telegram_chat_ids) return false;
      return a.telegram_chat_ids.split(",").map(s => s.trim()).includes(chatId);
    }) ?? null;
  }

  /** Send a message proactively to all Telegram chats linked to an agent. */
  async notifyAgentResult(agentTelegramChatIds: string, message: string): Promise<void> {
    if (!this.bot) return;
    const chatIds = agentTelegramChatIds.split(",").map(s => s.trim()).filter(Boolean);
    for (const chatId of chatIds) {
      for (const chunk of splitMessage(message)) {
        await this.bot.telegram.sendMessage(chatId, chunk, { parse_mode: "Markdown" }).catch((e) =>
          this.logger.error(`Failed to notify Telegram chat ${chatId}: ${e.message}`)
        );
      }
    }
  }

  /** Delete ALL Telegram conversations (called from Integrations → Disconnect). */
  deleteConversation(): void {
    const botUser = this.users.listAll().find((u) => u.role === "admin");
    if (!botUser) return;
    const map = this.loadChatMap();
    for (const convoId of Object.values(map)) {
      try { this.convos.delete(convoId); } catch { /* already gone */ }
    }
    this.settings.set("telegram_chat_map", "{}");
  }

  private loadChatMap(): Record<string, string> {
    const raw = this.settings.get("telegram_chat_map");
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  private saveChatMap(map: Record<string, string>): void {
    this.settings.set("telegram_chat_map", JSON.stringify(map));
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  onModuleDestroy() {
    this.bot?.stop("module-destroy");
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
