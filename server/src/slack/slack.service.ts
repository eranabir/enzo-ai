import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { App as BoltApp, LogLevel } from "@slack/bolt";
import { SettingsService } from "../settings/settings.service";
import { ConversationsService } from "../conversations/conversations.service";
import { UsersService } from "../users/users.service";
import { AgentsService } from "../agents/agents.service";

@Injectable()
export class SlackService implements OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private app: BoltApp | null = null;

  private runChat?: (userId: string, convoId: string, content: string, model?: string) => Promise<string>;

  constructor(
    private readonly settings: SettingsService,
    private readonly convos: ConversationsService,
    private readonly users: UsersService,
    private readonly agentsSvc: AgentsService,
  ) {}

  setRunner(fn: (userId: string, convoId: string, content: string, model?: string) => Promise<string>) {
    this.runChat = fn;
    if (this.settings.get("slack_enabled") === "1") {
      this.start().catch((e) => this.logger.error("Slack auto-start failed:", e.message));
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async start(notify = false): Promise<{ botName: string }> {
    const botToken = this.settings.get("slack_bot_token");
    const appToken = this.settings.get("slack_app_token");
    if (!botToken) throw new Error("Slack bot token not configured");
    if (!appToken)  throw new Error("Slack app-level token not configured");
    if (this.app) await this.stop();

    this.app = new BoltApp({
      token: botToken,
      appToken,
      socketMode: true,   // no public URL needed — connects via WebSocket
      logLevel: LogLevel.ERROR,
    });

    this.registerHandlers();
    await this.app.start();

    // Get bot info
    const info = await this.app.client.auth.test();
    const botName = String(info.user ?? "enzo-ai");

    this.settings.set("slack_enabled", "1");
    this.settings.set("slack_bot_name", botName); // store for DM titles
    this.logger.log(`Slack bot @${botName} connected via Socket Mode`);

    // List channels the bot is a member of and create conversations eagerly
    try {
      const result = await this.app.client.conversations.list({
        types: "public_channel,private_channel",
        limit: 200,
      });
      const memberChannels = (result.channels ?? []).filter((c: any) => c.is_member);
      this.logger.log(`Slack bot is member of ${memberChannels.length} channels`);

      for (const ch of memberChannels) {
        const channelId = ch.id as string;
        const chatTitle = `#${ch.name ?? channelId}`;

        // Eagerly create conversation so it appears in web UI immediately
        this.getOrCreateChatConversation(channelId, chatTitle);

        // Send connection message only on explicit connect
        if (notify) {
          await this.app.client.chat.postMessage({
            channel: channelId,
            text: `✅ *Enzo AI is online!* Send me a message or mention me to chat with your local AI.`,
          }).catch((e: Error) => this.logger.warn(`Could not notify #${ch.name}: ${e.message}`));
        }
      }
    } catch (e) {
      this.logger.error(`Failed to list Slack channels: ${(e as Error).message}`);
    }

    // Also DM allowed user IDs if configured and notify=true
    if (notify) {
      const allowedIds = this.settings.get("slack_allowed_ids");
      if (allowedIds) {
        for (const id of allowedIds.split(",").map(s => s.trim()).filter(Boolean)) {
          await this.app.client.chat.postMessage({
            channel: id,
            text: `✅ *Enzo AI bot is online!* DM me any time to chat.`,
          }).catch(() => this.logger.warn(`Could not DM Slack user ${id}`));
        }
      }
    }

    return { botName };
  }

  async stop(): Promise<void> {
    await this.app?.stop();
    this.app = null;
    this.settings.set("slack_enabled", "0");
    this.logger.log("Slack bot disconnected");
  }

  isRunning(): boolean {
    return this.app !== null;
  }

  async notifyAgentResult(channelIds: string, content: string): Promise<void> {
    if (!this.app) return;
    const ids = channelIds.split(",").map(s => s.trim()).filter(Boolean);
    for (const id of ids) {
      for (const chunk of splitMessage(content)) {
        await this.app.client.chat.postMessage({ channel: id, text: chunk }).catch((e) =>
          this.logger.error(`Failed to notify Slack ${id}: ${e.message}`)
        );
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
    this.settings.set("slack_chat_map", "{}");
  }

  /** Send a message to the Slack channel/DM backing a conversation.
   *  Relays web-UI replies back to Slack so both sides stay in sync. */
  async sendToConversation(convoId: string, text: string): Promise<void> {
    if (!this.app || !text.trim()) return;
    const map = this.loadChatMap();
    const channelId = Object.keys(map).find((k) => map[k] === convoId);
    if (!channelId) return;
    for (const chunk of splitMessage(text)) {
      await this.app.client.chat.postMessage({ channel: channelId, text: chunk }).catch((e) =>
        this.logger.error(`Failed to relay to Slack channel ${channelId}: ${e.message}`),
      );
    }
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  private registerHandlers(): void {
    if (!this.app) return;

    // Respond to any message the bot can see (DMs, mentions in channels)
    this.app.message(async ({ message, say, client }) => {
      const msg = message as any;

      // Skip bot messages and messages without text
      if (msg.subtype === "bot_message" || msg.bot_id || !msg.text) return;

      const slackUserId = msg.user;
      const channelId   = msg.channel;
      const channelType = msg.channel_type; // "im" = DM, "channel" = channel

      // Allowlist check
      const allowed = this.settings.get("slack_allowed_ids");
      if (allowed) {
        const ids = allowed.split(",").map(s => s.trim());
        if (!ids.includes(slackUserId) && !ids.includes(channelId)) return;
      }

      if (!this.runChat) {
        await say("⚠️ Server not ready yet, please try again.");
        return;
      }

      // Strip @mention from message text
      const text = msg.text.replace(/<@[A-Z0-9]+>/g, "").trim();
      if (!text) return;

      const isDM = channelType === "im";

      try {
        // Store the raw text so it renders cleanly in the web UI (same as web chat).
        const content = text;

        // Conversation title
        let chatTitle: string;
        if (isDM) {
          // Use bot name for DM conversations — clean and consistent
          chatTitle = this.settings.get("slack_bot_name") ?? "EnzoAI";
        } else {
          chatTitle = `#${channelId}`;
          try {
            const chInfo = await client.conversations.info({ channel: channelId });
            chatTitle = `#${(chInfo.channel as any)?.name ?? channelId}`;
          } catch { /* ignore */ }
        }

        // Find linked agent
        const linkedAgent = this.findAgentForChannel(channelId);
        const { userId, convoId } = this.getOrCreateChatConversation(
          channelId,
          linkedAgent ? `${linkedAgent.emoji} ${linkedAgent.name}` : chatTitle,
          linkedAgent?.id,
        );

        // Show typing indicator
        await client.reactions.add({ channel: channelId, timestamp: msg.ts, name: "thinking_face" }).catch(() => {});

        const model  = this.settings.get("slack_model") ?? undefined;
        const reply  = await this.runChat(userId, convoId, content, model);

        // Remove thinking emoji, send reply
        await client.reactions.remove({ channel: channelId, timestamp: msg.ts, name: "thinking_face" }).catch(() => {});

        for (const chunk of splitMessage(reply)) {
          await say({ text: chunk, thread_ts: isDM ? undefined : msg.ts });
        }

      } catch (err) {
        this.logger.error("Slack message handling failed:", (err as Error).message);
        await say("⚠️ Something went wrong. Please try again.").catch(() => {});
      }
    });

    this.app.error(async (error) => {
      this.logger.error("Slack error:", error.message);
    });
  }

  // ── Conversation management ────────────────────────────────────────────────

  getOrCreateChatConversation(channelId: string, chatTitle: string, agentId?: string): { userId: string; convoId: string } {
    const botUser = this.users.listAll().find((u) => u.role === "admin");
    if (!botUser) throw new Error("No admin user found");

    const map = this.loadChatMap();
    if (!map[channelId]) {
      const convo = this.convos.create(botUser.id, undefined, agentId, "slack");
      this.convos.rename(convo.id, chatTitle);
      map[channelId] = convo.id;
      this.saveChatMap(map);
    } else if (chatTitle) {
      // Update title in case it was previously saved as a raw channel ID
      this.convos.rename(map[channelId], chatTitle);
    }
    return { userId: botUser.id, convoId: map[channelId] };
  }

  private findAgentForChannel(channelId: string) {
    const botUser = this.users.listAll().find((u) => u.role === "admin");
    if (!botUser) return null;
    const agents = this.agentsSvc.list(botUser.id);
    return agents.find((a) => {
      if (!a.telegram_chat_ids) return false;
      return a.telegram_chat_ids.split(",").map(s => s.trim()).includes(channelId);
    }) ?? null;
  }

  private loadChatMap(): Record<string, string> {
    const raw = this.settings.get("slack_chat_map");
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  private saveChatMap(map: Record<string, string>): void {
    this.settings.set("slack_chat_map", JSON.stringify(map));
  }

  async onModuleDestroy() {
    await this.app?.stop().catch(() => {});
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
