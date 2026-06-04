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
    this.logger.log(`Slack bot @${botName} connected via Socket Mode`);

    if (notify) {
      // Send connection message to the first available channel
      const allowedIds = this.settings.get("slack_allowed_ids");
      if (allowedIds) {
        const ids = allowedIds.split(",").map(s => s.trim()).filter(Boolean);
        for (const id of ids) {
          try {
            await this.app.client.chat.postMessage({
              channel: id,
              text: `✅ *Enzo AI is online!* Mention me or DM me to start chatting with your local AI.`,
            });
          } catch {
            this.logger.warn(`Could not notify Slack channel/user ${id}`);
          }
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
        // Get sender display name
        let senderName = slackUserId;
        try {
          const userInfo = await client.users.info({ user: slackUserId });
          senderName = (userInfo.user as any)?.display_name || userInfo.user?.real_name || slackUserId;
        } catch { /* ignore */ }

        // In channels, prefix with sender name
        const content = isDM ? text : `[${senderName}]: ${text}`;

        // Channel name for the conversation title
        let chatTitle = `#${channelId}`;
        if (isDM) {
          chatTitle = senderName;
        } else {
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
