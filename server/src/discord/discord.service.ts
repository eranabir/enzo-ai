import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  Partials,
  TextChannel,
} from "discord.js";
import { SettingsService } from "../settings/settings.service";
import { ConversationsService } from "../conversations/conversations.service";
import { UsersService } from "../users/users.service";
import { AgentsService } from "../agents/agents.service";

@Injectable()
export class DiscordService implements OnModuleDestroy {
  private readonly logger = new Logger(DiscordService.name);
  private client: Client | null = null;

  // Injected lazily from app.module.ts to avoid circular deps
  private runChat?: (userId: string, convoId: string, content: string, model?: string) => Promise<string>;

  constructor(
    private readonly settings: SettingsService,
    private readonly convos: ConversationsService,
    private readonly users: UsersService,
    private readonly agentsSvc: AgentsService,
  ) {}

  setRunner(fn: (userId: string, convoId: string, content: string, model?: string) => Promise<string>) {
    this.runChat = fn;
    if (this.settings.get("discord_enabled") === "1") {
      this.start().catch((e) => this.logger.error("Discord auto-start failed:", e.message));
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async start(notify = false): Promise<{ tag: string }> {
    const token = this.settings.get("discord_bot_token");
    if (!token) throw new Error("Discord bot token not configured");
    if (this.client) this.stop();

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // privileged — must enable in Discord Dev Portal
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message], // needed for DM support
    });

    this.registerHandlers();

    await this.client.login(token);
    const tag = this.client.user?.tag ?? "Unknown";

    this.settings.set("discord_enabled", "1");
    this.logger.log(`Discord bot ${tag} connected`);

    if (notify) {
      // Send connection message to guilds + DM allowed users (explicit connect only)
      for (const [, guild] of this.client.guilds.cache) {
        try {
          const channels = await guild.channels.fetch();
          const textChannel = (guild.systemChannel
            ?? channels.find((ch) => ch?.isTextBased())) as TextChannel | undefined;
          if (textChannel) {
            await textChannel.send(
              `✅ **Enzo AI is online!**\n@mention me in this channel to chat with your local AI.\nYou can also DM me directly.`,
            );
          }
        } catch (e) {
          this.logger.warn(`Could not notify guild ${guild.name}: ${(e as Error).message}`);
        }
      }

      const allowedIds = this.settings.get("discord_allowed_ids");
      if (allowedIds) {
        for (const id of allowedIds.split(",").map(s => s.trim()).filter(Boolean)) {
          try {
            const user = await this.client.users.fetch(id);
            await user.send(`✅ **Enzo AI bot is online!** DM me any time to chat.`);
          } catch {
            this.logger.warn(`Could not DM Discord user ${id} — they may have DMs disabled`);
          }
        }
      }
    }

    return { tag };
  }

  stop(): void {
    this.client?.destroy();
    this.client = null;
    this.settings.set("discord_enabled", "0");
    this.logger.log("Discord bot disconnected");
  }

  isRunning(): boolean {
    return !!this.client?.isReady();
  }

  /** Send a message to a Discord channel (for agent scheduled runs). */
  async notifyAgentResult(channelIds: string, content: string): Promise<void> {
    if (!this.client) return;
    const ids = channelIds.split(",").map(s => s.trim()).filter(Boolean);
    for (const id of ids) {
      try {
        const channel = await this.client.channels.fetch(id);
        if (channel?.isTextBased()) {
          // Split long messages
          for (const chunk of splitMessage(content)) {
            await (channel as any).send(chunk);
          }
        }
      } catch (e) {
        this.logger.error(`Failed to notify Discord channel ${id}: ${(e as Error).message}`);
      }
    }
  }

  deleteConversation(): void {
    const botUser = this.users.listAll().find((u) => u.role === "admin");
    if (!botUser) return;
    const map = this.loadChatMap();
    for (const convoId of Object.values(map)) {
      try { this.convos.delete(convoId); } catch { /* already gone */ }
    }
    this.settings.set("discord_chat_map", "{}");
  }

  /** Send a message to the Discord channel/DM backing a conversation.
   *  Relays web-UI replies back to Discord so both sides stay in sync. */
  async sendToConversation(convoId: string, text: string): Promise<void> {
    if (!this.client || !text.trim()) return;
    const map = this.loadChatMap();
    const chatId = Object.keys(map).find((k) => map[k] === convoId);
    if (!chatId) return;
    try {
      if (chatId.startsWith("dm-")) {
        const user = await this.client.users.fetch(chatId.slice(3));
        for (const chunk of splitMessage(text)) await user.send(chunk);
      } else {
        const channel = await this.client.channels.fetch(chatId);
        if (channel?.isTextBased()) {
          for (const chunk of splitMessage(text)) await (channel as any).send(chunk);
        }
      }
    } catch (e) {
      this.logger.error(`Failed to relay to Discord chat ${chatId}: ${(e as Error).message}`);
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  private registerHandlers(): void {
    if (!this.client) return;

    this.client.once(Events.ClientReady, async (c) => {
      this.logger.log(`Discord ready: ${c.user.tag}`);
      // Set presence — always, on every connect including auto-restart
      c.user.setPresence({ status: "online", activities: [{ name: "Enzo AI", type: 4 }] });

      // Eagerly create conversations for each guild channel (no message sent here)
      for (const [, guild] of c.guilds.cache) {
        try {
          const channels = await guild.channels.fetch();
          const textChannel = (guild.systemChannel
            ?? channels.find((ch) => ch?.isTextBased())) as TextChannel | undefined;
          if (textChannel) {
            this.getOrCreateChatConversation(textChannel.id, `#${textChannel.name}`);
          }
        } catch (e) {
          this.logger.warn(`Guild "${guild.name}": ${(e as Error).message}`);
        }
      }
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      // Ignore bots (including ourselves)
      if (message.author.bot) return;

      const isDM      = message.channel.isDMBased();
      const isMention = this.client?.user ? message.mentions.has(this.client.user) : false;

      // In servers: only respond to @mentions
      // In DMs: always respond
      if (!isDM && !isMention) return;

      // Check allowlist
      const allowed = this.settings.get("discord_allowed_ids");
      if (allowed) {
        const ids = allowed.split(",").map(s => s.trim());
        if (!ids.includes(message.author.id)) return; // silently ignore
      }

      if (!this.runChat) {
        await message.reply("⚠️ Server not ready yet, please try again.");
        return;
      }

      // Strip @mention from the message content
      const text = message.content.replace(/<@!?\d+>/g, "").trim();
      if (!text) return;

      const isServer  = !isDM;
      const chatId    = isServer ? message.channelId : `dm-${message.author.id}`;
      const chatTitle = isServer
        ? `#${(message.channel as any).name ?? message.channelId}`
        : message.author.displayName ?? message.author.username;
      // Store the raw text so it renders cleanly in the web UI (same as web chat).
      const content = text;

      try {
        await (message.channel as any).sendTyping?.().catch(() => {});

        // Find a linked agent for this channel
        const linkedAgent = this.findAgentForChannel(chatId);
        const { userId, convoId } = this.getOrCreateChatConversation(
          chatId,
          linkedAgent ? `${linkedAgent.emoji} ${linkedAgent.name}` : chatTitle,
          linkedAgent?.id,
        );

        const model = this.settings.get("discord_model") ?? undefined;
        const typingInterval = setInterval(() =>
          (message.channel as any).sendTyping?.().catch(() => {}), 8000);
        let reply: string;
        try {
          reply = await this.runChat(userId, convoId, content, model);
        } finally {
          clearInterval(typingInterval);
        }

        for (const chunk of splitMessage(reply, 2000)) {
          await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
        }

      } catch (err) {
        this.logger.error("Discord message handling failed:", (err as Error).message);
        await message.reply("⚠️ Something went wrong. Please try again.");
      }
    });

    this.client.on(Events.Error, (err) => {
      this.logger.error("Discord client error:", err.message);
    });
  }

  // ── Conversation management ────────────────────────────────────────────────

  getOrCreateChatConversation(chatId: string, chatTitle: string, agentId?: string): { userId: string; convoId: string } {
    const botUser = this.users.listAll().find((u) => u.role === "admin");
    if (!botUser) throw new Error("No admin user found");

    const map = this.loadChatMap();
    if (!map[chatId]) {
      const convo = this.convos.create(botUser.id, undefined, agentId, "discord");
      this.convos.rename(convo.id, chatTitle);
      map[chatId] = convo.id;
      this.saveChatMap(map);
    }
    return { userId: botUser.id, convoId: map[chatId] };
  }

  private findAgentForChannel(channelId: string) {
    const botUser = this.users.listAll().find((u) => u.role === "admin");
    if (!botUser) return null;
    const agents = this.agentsSvc.list(botUser.id);
    return agents.find((a) => {
      if (!a.telegram_chat_ids) return false; // reuse same field for now
      return a.telegram_chat_ids.split(",").map(s => s.trim()).includes(channelId);
    }) ?? null;
  }

  private loadChatMap(): Record<string, string> {
    const raw = this.settings.get("discord_chat_map");
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  private saveChatMap(map: Record<string, string>): void {
    this.settings.set("discord_chat_map", JSON.stringify(map));
  }

  onModuleDestroy() {
    this.client?.destroy();
  }
}

function splitMessage(text: string, limit = 2000): string[] {
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
