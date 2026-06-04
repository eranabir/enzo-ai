import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { SettingsService } from "../settings/settings.service";
import { ConversationsService } from "../conversations/conversations.service";
import { UsersService } from "../users/users.service";


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

  /** Start the bot and return the verified bot username. */
  async start(): Promise<{ username: string }> {
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

    // Notify allowed users that the bot is online
    const allowedIds = this.settings.get("telegram_allowed_ids");
    if (allowedIds) {
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

    this.bot.on(message("text"), async (ctx) => {
      const telegramUserId = String(ctx.from.id);
      const text           = ctx.message.text;

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
        const { userId, convoId } = this.getOrCreateConversation();
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

  /** Get or create the single dedicated Telegram conversation for the admin user. */
  getOrCreateConversation(): { userId: string; convoId: string } {
    const botUser = this.users.listAll().find((u) => u.role === "admin");
    if (!botUser) throw new Error("No admin user found to run the bot as");

    // Reuse existing integration conversation if already created
    let convo = this.convos.getByIntegration(botUser.id, "telegram");
    if (!convo) {
      convo = this.convos.create(botUser.id, undefined, undefined, "telegram");
      this.convos.rename(convo.id, "💬 Telegram");
    }

    return { userId: botUser.id, convoId: convo.id };
  }

  /** Delete the dedicated Telegram conversation (called from Integrations → Disconnect). */
  deleteConversation(): void {
    const botUser = this.users.listAll().find((u) => u.role === "admin");
    if (!botUser) return;
    const convo = this.convos.getByIntegration(botUser.id, "telegram");
    if (convo) {
      // Bypass the integration guard — we own this
      this.convos.delete(convo.id);
    }
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
