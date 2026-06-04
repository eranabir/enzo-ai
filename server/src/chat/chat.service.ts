import { Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { ConversationsService } from "../conversations/conversations.service";
import { LlmService } from "../llm/llm.service";
import { UsersService } from "../users/users.service";
import { SettingsService } from "../settings/settings.service";
import { MemoriesService } from "../memories/memories.service";
import { MemoryExtractionService } from "../memories/memory-extraction.service";
import { AgentsService } from "../agents/agents.service";
import { ToolsService, type ToolName } from "../agents/tools.service";
import type { ChatMessage } from "../llm/provider.types";
import type { ConversationRow } from "../database/database.types";
import type { UserRow } from "../users/users.types";
import { config } from "../config";

export interface ChatEvent {
  token?: string;
  title?: string;
  error?: string;
  done?: boolean;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly convos: ConversationsService,
    private readonly llm: LlmService,
    private readonly users: UsersService,
    private readonly settings: SettingsService,
    private readonly memoriesService: MemoriesService,
    private readonly extraction: MemoryExtractionService,
    private readonly agentsService: AgentsService,
    private readonly toolsService: ToolsService,
  ) {}

  /**
   * Build the system prompt.
   *
   * When memory is ON:   profile + long-term memories + recent conversation summaries
   * When memory is OFF:  profile only (clean prompt, predictable tokens for paid APIs)
   */
  private buildSystemPrompt(
    user: UserRow | undefined,
    convoId: string,
    memoryEnabled: boolean,
    agentInstructions?: string,
  ): string {
    // Agent instructions take priority — they define the persona
    const lines = agentInstructions
      ? [agentInstructions]
      : [
          "You are Enzo AI, a helpful, concise, locally-running AI assistant.",
          "You run entirely on the user's own machine and value their privacy.",
        ];

    if (user) {
      lines.push(`The person you are assisting goes by "${user.username}".`);
      if (user.super_powers)
        lines.push(`Their areas of expertise: ${user.super_powers}.`);
      if (user.about)
        lines.push(`About them: ${user.about}`);
      if (user.assistant_style)
        lines.push(`They prefer responses like this: ${user.assistant_style}`);
    }

    if (!user || !memoryEnabled) return lines.join(" ");

    // ── Inject long-term memories ──────────────────────────────────────────
    const memories = this.memoriesService.recent(user.id, 8);
    if (memories.length > 0) {
      lines.push("\n\nWhat you remember about this person:");
      for (const m of memories) {
        lines.push(`- [${m.type}] ${m.content}`);
      }
    }

    // ── Inject recent conversation summaries ──────────────────────────────
    const summaries = this.memoriesService.recentSummaries(user.id, convoId, 3);
    if (summaries.length > 0) {
      lines.push("\n\nRecent work context (from previous conversations):");
      for (const s of summaries) {
        lines.push(`- ${s.summary}`);
      }
    }

    return lines.join(" ");
  }

  /** Save a base64-encoded image to disk, return the file path. */
  async saveImage(messageId: string, base64: string, mime: string): Promise<void> {
    const uploadsDir = path.join(config.dataDir, "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
    const filePath = path.join(uploadsDir, `${messageId}.${ext}`);
    await fs.writeFile(filePath, Buffer.from(base64, "base64"));
  }

  /** Load a stored image as base64, or null if not found. */
  async loadImage(messageId: string, mime: string): Promise<string | null> {
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
    const filePath = path.join(config.dataDir, "uploads", `${messageId}.${ext}`);
    try {
      const buf = await fs.readFile(filePath);
      return buf.toString("base64");
    } catch {
      return null;
    }
  }

  /** Get the raw buffer + mime for serving the image over HTTP. */
  async getImageBuffer(messageId: string, mime: string): Promise<Buffer | null> {
    const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
    const filePath = path.join(config.dataDir, "uploads", `${messageId}.${ext}`);
    try { return await fs.readFile(filePath); } catch { return null; }
  }

  async *streamReply(
    convo: ConversationRow,
    userId: string,
    content: string,
    requestedModel: string | undefined,
    signal: AbortSignal,
    imageBase64?: string,
    imageMime?: string,
  ): AsyncIterable<ChatEvent> {
    // Load attached agent (if any)
    const agent = (convo as any).agent_id
      ? this.agentsService.get((convo as any).agent_id, userId) ?? null
      : null;
    const agentTools = agent ? (JSON.parse(agent.tools) as ToolName[]) : [];

    const model = requestedModel || agent?.model || convo.model || this.settings.getDefaultModel();
    this.convos.setModel(convo.id, model);

    const memoryEnabled = convo.memory_enabled !== 0;
    const user = this.users.findById(userId);

    const userMsg = this.convos.addMessage(convo.id, "user", content, imageMime);
    if (imageBase64 && imageMime) {
      await this.saveImage(userMsg.id, imageBase64, imageMime);
    }

    const allMessages = this.convos.listMessages(convo.id);
    // Build history; for messages with images, load data from disk so providers can use it
    const history: ChatMessage[] = await Promise.all(
      allMessages.map(async (m) => {
        const base: ChatMessage = { role: m.role as any, content: m.content };
        if (m.image_mime) {
          const data = await this.loadImage(m.id, m.image_mime);
          if (data) { base.imageData = data; base.imageMime = m.image_mime; }
        }
        return base;
      }),
    );

    const systemPrompt = this.buildSystemPrompt(
      user, convo.id, memoryEnabled, agent?.instructions,
    );
    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...history];

    const provider = await this.llm.resolveProvider(model, userId);
    let assistant = "";

    try {
      if (!provider) {
        throw new Error(`No API key configured for ${model.split(":")[0]}. Add it in Admin → Models → External AI.`);
      }
      if (provider.id === "ollama" && !(await this.llm.ollama.isAvailable())) {
        throw new Error("Local model engine (Ollama) is not running. Start Ollama and try again.");
      }

      // ── Tool-use loop ─────────────────────────────────────────────────────
      // If the agent has tools, run non-streaming rounds until no more tool calls,
      // then stream the final response.
      if (agentTools.length > 0 && provider.id === "ollama") {
        const toolDefs = this.toolsService.getDefinitions(agentTools);
        let loopMessages = [...messages];
        const MAX_TOOL_ROUNDS = 5;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          // Non-streaming call to detect tool calls
          const ollamaUrl = "http://127.0.0.1:11434";
          const res = await fetch(`${ollamaUrl}/api/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: model.replace(/^ollama:/, ""), messages: loopMessages, tools: toolDefs, stream: false }),
            signal,
          });
          if (!res.ok) throw new Error(`Ollama tool call failed: ${res.status}`);
          const data = await res.json() as any;
          const msg = data?.message;

          if (!msg?.tool_calls?.length) {
            // No more tool calls — stream the final text
            assistant = msg?.content ?? "";
            if (assistant) {
              for (const char of assistant) { yield { token: char }; }
            }
            break;
          }

          // Execute each tool call
          loopMessages.push({ role: "assistant", content: msg.content ?? "" });
          for (const tc of msg.tool_calls) {
            const toolName = tc.function?.name;
            const toolArgs = tc.function?.arguments ?? {};
            this.logger.debug(`Tool call: ${toolName}(${JSON.stringify(toolArgs)})`);
            yield { token: `\n\`🔧 ${toolName}\`\n` };
            const result = await this.toolsService.execute(toolName, toolArgs);
            loopMessages.push({ role: "tool", content: result } as any);
          }
        }
      } else {
        // Standard streaming (no tools or external provider)
        for await (const token of provider.streamChat({ model, messages, signal })) {
          assistant += token;
          yield { token };
        }
      }

      this.convos.addMessage(convo.id, "assistant", assistant);

      if (convo.title === "New chat") {
        const title = (agent ? `[${agent.emoji} ${agent.name}] ` : "") + content.slice(0, 50) + (content.length > 50 ? "…" : "");
        this.convos.rename(convo.id, title);
        yield { title };
      }
      yield { done: true };

      if (memoryEnabled && user) {
        const updatedMessages = this.convos.listMessages(convo.id);
        if (this.extraction.shouldExtract(convo.id, updatedMessages)) {
          this.extraction.extractInBackground(convo.id, userId, updatedMessages);
        }
      }
    } catch (err) {
      if (assistant) this.convos.addMessage(convo.id, "assistant", assistant);
      yield { error: (err as Error).message };
    }
  }

  /**
   * Process a message in an existing conversation and return the complete reply.
   * Used by Telegram, CLI, and other non-streaming clients.
   */
  async processMessage(userId: string, convoId: string, content: string, model?: string): Promise<string> {
    const convo = this.convos.get(convoId, userId);
    if (!convo) throw new Error(`Conversation ${convoId} not found for user ${userId}`);
    const controller = new AbortController();
    let reply = "";
    for await (const event of this.streamReply(convo, userId, content, model, controller.signal)) {
      if (event.token) reply += event.token;
      if (event.error) throw new Error(event.error);
    }
    return reply || "No response";
  }

  /** Run an agent's scheduled prompt as a background conversation (result saved to memories). Returns the result text. */
  async runScheduledAgent(agentId: string, userId: string, prompt: string): Promise<string> {
    const agent = this.agentsService.get(agentId, userId);
    if (!agent) return "";
    const user = this.users.findById(userId);
    if (!user) return "";

    const model = agent.model || this.settings.getDefaultModel();
    const provider = await this.llm.resolveProvider(model, userId);
    if (!provider) return "";

    const messages: ChatMessage[] = [
      { role: "system", content: agent.instructions },
      { role: "user", content: prompt },
    ];

    let result = "";
    try {
      for await (const token of provider.streamChat({ model, messages })) {
        result += token;
      }
      if (result && user) {
        this.memoriesService.add(userId, "work_context",
          `[${agent.emoji} ${agent.name} scheduled run] ${result.slice(0, 500)}`);
      }
    } catch (err) {
      this.logger.error(`Scheduled agent failed: ${(err as Error).message}`);
    }
    return result;
  }
}
