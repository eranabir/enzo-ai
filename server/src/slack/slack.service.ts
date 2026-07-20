import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { App as BoltApp, LogLevel } from "@slack/bolt";
import { SettingsService } from "../settings/settings.service";
import { ChatsService } from "../chats/chats.service";
import { UsersService } from "../users/users.service";
import { AgentsService } from "../agents/agents.service";

/** Per-user settings keys — each user runs their own Slack app. */
const K = {
  botToken: (u: string) => `slack_bot_token_${u}`,
  appToken: (u: string) => `slack_app_token_${u}`,
  botName:  (u: string) => `slack_bot_name_${u}`,
  allowed:  (u: string) => `slack_allowed_ids_${u}`,
  enabled:  (u: string) => `slack_enabled_${u}`,
  chatMap:  (u: string) => `slack_chat_map_${u}`,
};

@Injectable()
export class SlackService implements OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);

  // ownerUserId → that user's live Slack app.
  private apps = new Map<string, { app: BoltApp; botName: string }>();

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

  async start(userId: string, notify = false): Promise<{ botName: string }> {
    if (!this.settings.isConnectionEnabled("slack")) {
      throw new Error("Slack is disabled by the administrator");
    }
    const botToken = this.settings.get(K.botToken(userId));
    const appToken = this.settings.get(K.appToken(userId));
    if (!botToken) throw new Error("Slack bot token not configured");
    if (!appToken)  throw new Error("Slack app-level token not configured");
    await this.stop(userId);

    const app = new BoltApp({ token: botToken, appToken, socketMode: true, logLevel: LogLevel.ERROR });
    this.registerHandlers(userId, app);
    await app.start();

    const info = await app.client.auth.test();
    const botName = String(info.user ?? "enzo-ai");
    this.apps.set(userId, { app, botName });
    this.settings.set(K.enabled(userId), "1");
    this.settings.set(K.botName(userId), botName);
    this.logger.log(`Slack bot @${botName} connected for user ${userId}`);

    try {
      const result = await app.client.conversations.list({ types: "public_channel,private_channel", limit: 200 });
      const memberChannels = (result.channels ?? []).filter((c: any) => c.is_member);
      for (const ch of memberChannels) {
        const channelId = ch.id as string;
        this.getOrCreateChat(userId, channelId, `#${ch.name ?? channelId}`);
        if (notify) {
          await app.client.chat.postMessage({
            channel: channelId,
            text: `✅ *Enzo AI is online!* Send me a message or mention me to chat with your local AI.`,
          }).catch((e: Error) => this.logger.warn(`Could not notify #${ch.name}: ${e.message}`));
        }
      }
    } catch (e) {
      this.logger.error(`Failed to list Slack channels: ${(e as Error).message}`);
    }

    if (notify) {
      const allowedIds = this.settings.get(K.allowed(userId));
      for (const id of (allowedIds ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
        await app.client.chat.postMessage({ channel: id, text: `✅ *Enzo AI bot is online!* DM me any time to chat.` })
          .catch(() => this.logger.warn(`Could not DM Slack user ${id}`));
      }
    }

    return { botName };
  }

  async stop(userId: string): Promise<void> {
    const entry = this.apps.get(userId);
    if (entry) {
      await entry.app.stop().catch(() => {});
      this.apps.delete(userId);
      this.logger.log(`Slack bot disconnected for user ${userId}`);
    }
    this.settings.set(K.enabled(userId), "0");
  }

  isRunning(userId: string): boolean {
    return this.apps.has(userId);
  }

  /** Stop every running app (admin disabled the connection). */
  async stopAllRunning(): Promise<void> {
    for (const [, entry] of this.apps) await entry.app.stop().catch(() => {});
    this.apps.clear();
    this.logger.log("All Slack apps stopped (connection disabled by admin)");
  }

  /** Start apps for every user who has it enabled (admin re-enabled it). */
  startAllEnabled(): void {
    for (const u of this.users.listAll()) {
      if (this.settings.get(K.enabled(u.id)) === "1") {
        this.start(u.id).catch((e) => this.logger.error(`Slack start failed for ${u.id}: ${e.message}`));
      }
    }
  }

  updateConfig(userId: string, cfg: { botToken?: string; appToken?: string; allowedIds?: string }): void {
    if (cfg.allowedIds != null) this.settings.set(K.allowed(userId), String(cfg.allowedIds).trim());
    if (cfg.botToken?.trim()) this.settings.set(K.botToken(userId), cfg.botToken.trim());
    if (cfg.appToken?.trim()) this.settings.set(K.appToken(userId), cfg.appToken.trim());
  }

  getStatus(userId: string) {
    return {
      available: this.settings.isConnectionEnabled("slack"),
      enabled: this.isRunning(userId),
      botName: this.settings.get(K.botName(userId)) ?? null,
      botToken: this.settings.get(K.botToken(userId)) ? "••••••••" : null,
      appToken: this.settings.get(K.appToken(userId)) ? "••••••••" : null,
      allowedIds: this.settings.get(K.allowed(userId)) ?? "",
    };
  }

  async notifyAgentResult(userId: string, channelIds: string, content: string): Promise<void> {
    const entry = this.apps.get(userId);
    if (!entry) return;
    for (const id of channelIds.split(",").map((s) => s.trim()).filter(Boolean)) {
      for (const chunk of splitMessage(content)) {
        await entry.app.client.chat.postMessage({ channel: id, text: chunk })
          .catch((e: Error) => this.logger.error(`Failed to notify Slack ${id}: ${e.message}`));
      }
    }
  }

  /** Clear a user's saved Slack config (tokens/name/allowlist). */
  clearConfig(userId: string): void {
    this.settings.set(K.botToken(userId), "");
    this.settings.set(K.appToken(userId), "");
    this.settings.set(K.botName(userId), "");
    this.settings.set(K.allowed(userId), "");
  }

  deleteChat(userId: string): void {
    const map = this.loadChatMap(userId);
    for (const convoId of Object.values(map)) {
      try { this.convos.delete(convoId); } catch { /* already gone */ }
    }
    this.settings.set(K.chatMap(userId), "{}");
    // Also sweep any orphaned chats tagged with this integration.
    try { this.convos.deleteByConnection(userId, "slack"); } catch { /* ignore */ }
  }

  /** Relay a web-UI reply back to the Slack channel/DM backing a chat. */
  async sendToChat(userId: string, convoId: string, text: string): Promise<void> {
    const entry = this.apps.get(userId);
    if (!entry || !text.trim()) return;
    const map = this.loadChatMap(userId);
    const channelId = Object.keys(map).find((k) => map[k] === convoId);
    if (!channelId) return;
    for (const chunk of splitMessage(text)) {
      await entry.app.client.chat.postMessage({ channel: channelId, text: chunk })
        .catch((e: Error) => this.logger.error(`Failed to relay to Slack channel ${channelId}: ${e.message}`));
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  private registerHandlers(ownerUserId: string, app: BoltApp): void {
    app.message(async ({ message, say, client }) => {
      const msg = message as any;
      if (msg.subtype === "bot_message" || msg.bot_id || !msg.text) return;

      const slackUserId = msg.user;
      const channelId   = msg.channel;
      const channelType = msg.channel_type;

      const allowed = this.settings.get(K.allowed(ownerUserId));
      if (allowed) {
        const ids = allowed.split(",").map((s) => s.trim());
        if (!ids.includes(slackUserId) && !ids.includes(channelId)) return;
      }

      if (!this.runChat) {
        await say("⚠️ Server not ready yet, please try again.");
        return;
      }

      const text = msg.text.replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!text) return;

      const isDM = channelType === "im";

      try {
        const content = text;

        let chatTitle: string;
        if (isDM) {
          chatTitle = this.settings.get(K.botName(ownerUserId)) ?? "Slack";
        } else {
          chatTitle = `#${channelId}`;
          try {
            const chInfo = await client.conversations.info({ channel: channelId });
            chatTitle = `#${(chInfo.channel as any)?.name ?? channelId}`;
          } catch { /* ignore */ }
        }

        const linkedAgent = this.findAgentForChannel(ownerUserId, channelId);
        const { userId, convoId } = this.getOrCreateChat(
          ownerUserId,
          channelId,
          linkedAgent ? `${linkedAgent.emoji} ${linkedAgent.name}` : chatTitle,
          linkedAgent?.id,
        );

        await client.reactions.add({ channel: channelId, timestamp: msg.ts, name: "thinking_face" }).catch(() => {});
        const reply = await this.runChat(userId, convoId, content);
        await client.reactions.remove({ channel: channelId, timestamp: msg.ts, name: "thinking_face" }).catch(() => {});

        for (const chunk of splitMessage(reply)) {
          await say({ text: chunk, thread_ts: isDM ? undefined : msg.ts });
        }
      } catch (err) {
        this.logger.error("Slack message handling failed:", (err as Error).message);
        await say("⚠️ Something went wrong. Please try again.").catch(() => {});
      }
    });

    app.error(async (error) => this.logger.error("Slack error:", error.message));
  }

  // ── Chat management (per user) ───────────────────────────────────────

  getOrCreateChat(ownerUserId: string, channelId: string, chatTitle: string, agentId?: string): { userId: string; convoId: string } {
    const map = this.loadChatMap(ownerUserId);
    if (!map[channelId]) {
      const convo = this.convos.create(ownerUserId, undefined, agentId, "slack");
      this.convos.rename(convo.id, chatTitle);
      map[channelId] = convo.id;
      this.saveChatMap(ownerUserId, map);
    } else if (chatTitle) {
      this.convos.rename(map[channelId], chatTitle);
    }
    return { userId: ownerUserId, convoId: map[channelId] };
  }

  private findAgentForChannel(ownerUserId: string, channelId: string) {
    const agents = this.agentsSvc.list(ownerUserId);
    return agents.find((a) => {
      if (!a.telegram_chat_ids) return false;
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

  async onModuleDestroy() {
    for (const [, entry] of this.apps) await entry.app.stop().catch(() => {});
  }
}

function splitMessage(text: string, limit = 3000): string[] {
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
