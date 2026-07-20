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
import { ChatsService } from "../chats/chats.service";
import { UsersService } from "../users/users.service";
import { AgentsService } from "../agents/agents.service";

/** Per-user settings keys — each user runs their own Discord bot. */
const K = {
  token:   (u: string) => `discord_bot_token_${u}`,
  allowed: (u: string) => `discord_allowed_ids_${u}`,
  enabled: (u: string) => `discord_enabled_${u}`,
  chatMap: (u: string) => `discord_chat_map_${u}`,
};

@Injectable()
export class DiscordService implements OnModuleDestroy {
  private readonly logger = new Logger(DiscordService.name);

  // ownerUserId → that user's live Discord client.
  private clients = new Map<string, { client: Client; tag: string }>();

  private runChat?: (userId: string, convoId: string, content: string) => Promise<string>;

  constructor(
    private readonly settings: SettingsService,
    private readonly convos: ChatsService,
    private readonly users: UsersService,
    private readonly agentsSvc: AgentsService,
  ) {}

  setRunner(fn: (userId: string, convoId: string, content: string) => Promise<string>) {
    // Bots start via startAllEnabled() once the vault is ready (see AppModule).
    this.runChat = fn;
  }

  // ── Public API (per user) ───────────────────────────────────────────────────

  async start(userId: string, notify = false): Promise<{ tag: string }> {
    if (!this.settings.isConnectionEnabled("discord")) {
      throw new Error("Discord is disabled by the administrator");
    }
    const token = this.settings.get(K.token(userId));
    if (!token) throw new Error("Discord bot token not configured");
    this.stop(userId);

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.registerHandlers(userId, client);
    await client.login(token);
    const tag = client.user?.tag ?? "Unknown";

    this.clients.set(userId, { client, tag });
    this.settings.set(K.enabled(userId), "1");
    this.logger.log(`Discord bot ${tag} connected for user ${userId}`);

    if (notify) {
      for (const [, guild] of client.guilds.cache) {
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
      const allowedIds = this.settings.get(K.allowed(userId));
      for (const id of (allowedIds ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
        try {
          const u = await client.users.fetch(id);
          await u.send(`✅ **Enzo AI bot is online!** DM me any time to chat.`);
        } catch {
          this.logger.warn(`Could not DM Discord user ${id} — they may have DMs disabled`);
        }
      }
    }

    return { tag };
  }

  stop(userId: string): void {
    const entry = this.clients.get(userId);
    if (entry) {
      entry.client.destroy();
      this.clients.delete(userId);
      this.logger.log(`Discord bot disconnected for user ${userId}`);
    }
    this.settings.set(K.enabled(userId), "0");
  }

  isRunning(userId: string): boolean {
    return !!this.clients.get(userId)?.client.isReady();
  }

  /** Stop every running bot (admin disabled the connection). */
  stopAllRunning(): void {
    for (const [, entry] of this.clients) entry.client.destroy();
    this.clients.clear();
    this.logger.log("All Discord bots stopped (connection disabled by admin)");
  }

  /** Start bots for every user who has it enabled (admin re-enabled it). */
  startAllEnabled(): void {
    for (const u of this.users.listAll()) {
      if (this.settings.get(K.enabled(u.id)) === "1") {
        this.start(u.id).catch((e) => this.logger.error(`Discord start failed for ${u.id}: ${e.message}`));
      }
    }
  }

  updateConfig(userId: string, cfg: { token?: string; allowedIds?: string }): void {
    if (cfg.allowedIds != null) this.settings.set(K.allowed(userId), String(cfg.allowedIds).trim());
    if (cfg.token?.trim()) this.settings.set(K.token(userId), cfg.token.trim());
  }

  getStatus(userId: string) {
    return {
      available: this.settings.isConnectionEnabled("discord"),
      enabled: this.isRunning(userId),
      tag: this.clients.get(userId)?.tag ?? null,
      token: this.settings.get(K.token(userId)) ? "••••••••" : null,
      allowedIds: this.settings.get(K.allowed(userId)) ?? "",
    };
  }

  /** Relay an agent's scheduled result to the user's linked Discord channels. */
  async notifyAgentResult(userId: string, channelIds: string, content: string): Promise<void> {
    const entry = this.clients.get(userId);
    if (!entry) return;
    for (const id of channelIds.split(",").map((s) => s.trim()).filter(Boolean)) {
      try {
        const channel = await entry.client.channels.fetch(id);
        if (channel?.isTextBased()) {
          for (const chunk of splitMessage(content)) await (channel as any).send(chunk);
        }
      } catch (e) {
        this.logger.error(`Failed to notify Discord channel ${id}: ${(e as Error).message}`);
      }
    }
  }

  /** Clear a user's saved Discord config (token/allowlist). */
  clearConfig(userId: string): void {
    this.settings.set(K.token(userId), "");
    this.settings.set(K.allowed(userId), "");
  }

  deleteChat(userId: string): void {
    const map = this.loadChatMap(userId);
    for (const convoId of Object.values(map)) {
      try { this.convos.delete(convoId); } catch { /* already gone */ }
    }
    this.settings.set(K.chatMap(userId), "{}");
    // Also sweep any orphaned chats tagged with this integration.
    try { this.convos.deleteByConnection(userId, "discord"); } catch { /* ignore */ }
  }

  /** Relay a web-UI reply back to the Discord channel/DM backing a chat. */
  async sendToChat(userId: string, convoId: string, text: string): Promise<void> {
    const entry = this.clients.get(userId);
    if (!entry || !text.trim()) return;
    const map = this.loadChatMap(userId);
    const chatId = Object.keys(map).find((k) => map[k] === convoId);
    if (!chatId) return;
    try {
      if (chatId.startsWith("dm-")) {
        const u = await entry.client.users.fetch(chatId.slice(3));
        for (const chunk of splitMessage(text)) await u.send(chunk);
      } else {
        const channel = await entry.client.channels.fetch(chatId);
        if (channel?.isTextBased()) {
          for (const chunk of splitMessage(text)) await (channel as any).send(chunk);
        }
      }
    } catch (e) {
      this.logger.error(`Failed to relay to Discord chat ${chatId}: ${(e as Error).message}`);
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  private registerHandlers(ownerUserId: string, client: Client): void {
    client.once(Events.ClientReady, async (c) => {
      this.logger.log(`Discord ready (user ${ownerUserId}): ${c.user.tag}`);
      c.user.setPresence({ status: "online", activities: [{ name: "Enzo AI", type: 4 }] });
      for (const [, guild] of c.guilds.cache) {
        try {
          const channels = await guild.channels.fetch();
          const textChannel = (guild.systemChannel
            ?? channels.find((ch) => ch?.isTextBased())) as TextChannel | undefined;
          if (textChannel) {
            this.getOrCreateChat(ownerUserId, textChannel.id, `#${textChannel.name}`);
          }
        } catch (e) {
          this.logger.warn(`Guild "${guild.name}": ${(e as Error).message}`);
        }
      }
    });

    client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.bot) return;

      const isDM      = message.channel.isDMBased();
      const isMention = client.user ? message.mentions.has(client.user) : false;
      if (!isDM && !isMention) return;

      const allowed = this.settings.get(K.allowed(ownerUserId));
      if (allowed) {
        const ids = allowed.split(",").map((s) => s.trim());
        if (!ids.includes(message.author.id)) return;
      }

      if (!this.runChat) {
        await message.reply("⚠️ Server not ready yet, please try again.");
        return;
      }

      const text = message.content.replace(/<@!?\d+>/g, "").trim();
      if (!text) return;

      const isServer  = !isDM;
      const chatId    = isServer ? message.channelId : `dm-${message.author.id}`;
      const chatTitle = isServer
        ? `#${(message.channel as any).name ?? message.channelId}`
        : message.author.displayName ?? message.author.username;
      const content = text;

      // Declared outside the try block so the catch handler can still save
      // the failure into the chat's own history (see telegram.service.ts for
      // why: otherwise a mid-request failure is invisible in EnzoAI's own
      // mirrored view of the conversation even though Discord got a reply).
      let convoId: string | undefined;
      try {
        await (message.channel as any).sendTyping?.().catch(() => {});

        const linkedAgent = this.findAgentForChannel(ownerUserId, chatId);
        const created = this.getOrCreateChat(
          ownerUserId,
          chatId,
          linkedAgent ? `${linkedAgent.emoji} ${linkedAgent.name}` : chatTitle,
          linkedAgent?.id,
        );
        convoId = created.convoId;
        const userId = created.userId;

        const typingInterval = setInterval(() => (message.channel as any).sendTyping?.().catch(() => {}), 8000);
        let reply: string;
        try {
          reply = await this.runChat(userId, convoId, content);
        } finally {
          clearInterval(typingInterval);
        }

        for (const chunk of splitMessage(reply, 2000)) {
          await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
        }
      } catch (err) {
        this.logger.error("Discord message handling failed:", (err as Error).message);
        const errorReply = "⚠️ Something went wrong. Please try again.";
        if (convoId) this.convos.addMessage(convoId, "assistant", errorReply);
        await message.reply(errorReply);
      }
    });

    client.on(Events.Error, (err) => this.logger.error("Discord client error:", err.message));
  }

  // ── Chat management (per user) ───────────────────────────────────────

  getOrCreateChat(ownerUserId: string, chatId: string, chatTitle: string, agentId?: string): { userId: string; convoId: string } {
    const map = this.loadChatMap(ownerUserId);
    if (!map[chatId]) {
      const convo = this.convos.create(ownerUserId, undefined, agentId, "discord");
      this.convos.rename(convo.id, chatTitle);
      map[chatId] = convo.id;
      this.saveChatMap(ownerUserId, map);
    }
    return { userId: ownerUserId, convoId: map[chatId] };
  }

  private findAgentForChannel(ownerUserId: string, channelId: string) {
    const agents = this.agentsSvc.list(ownerUserId);
    return agents.find((a) => {
      if (!a.telegram_chat_ids) return false; // reuse same field for now
      return a.telegram_chat_ids.split(",").map((s) => s.trim()).includes(channelId);
    }) ?? null;
  }

  private loadChatMap(userId: string): Record<string, string> {
    const raw = this.settings.get(K.chatMap(userId));
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  private saveChatMap(userId: string, map: Record<string, string>): void {
    this.settings.set(K.chatMap(userId), JSON.stringify(map));
  }

  onModuleDestroy() {
    for (const [, entry] of this.clients) entry.client.destroy();
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
