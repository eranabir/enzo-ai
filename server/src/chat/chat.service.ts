import { Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { ChatsService } from "../chats/chats.service";
import { LlmService } from "../llm/llm.service";
import { UsersService } from "../users/users.service";
import { SettingsService } from "../settings/settings.service";
import { MemoriesService } from "../memories/memories.service";
import { MemoryExtractionService } from "../memories/memory-extraction.service";
import { AgentsService } from "../agents/agents.service";
import { ToolsService, type ToolName } from "../agents/tools.service";
import { McpService } from "../mcp/mcp.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { VaultService } from "../vault/vault.service";
import type { ChatMessage } from "../llm/provider.types";
import type { ChatRow } from "../database/database.types";
import type { UserRow } from "../users/users.types";
import { config } from "../config";
import { extractDocumentText } from "./document-extract";

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
    private readonly convos: ChatsService,
    private readonly llm: LlmService,
    private readonly users: UsersService,
    private readonly settings: SettingsService,
    private readonly memoriesService: MemoriesService,
    private readonly extraction: MemoryExtractionService,
    private readonly agentsService: AgentsService,
    private readonly toolsService: ToolsService,
    private readonly mcpService: McpService,
    private readonly knowledge: KnowledgeService,
    private readonly vault: VaultService,
  ) {}

  // Wired from app.module to push assistant replies out to an integration
  // (Telegram/Discord/Slack) when a message is sent from the web UI in an
  // integration-linked chat. Avoids a circular module dependency.
  private relayToIntegration?: (
    integration: string,
    userId: string,
    convoId: string,
    text: string,
  ) => Promise<void>;

  setIntegrationRelay(
    fn: (integration: string, userId: string, convoId: string, text: string) => Promise<void>,
  ): void {
    this.relayToIntegration = fn;
  }

  /**
   * Build the system prompt.
   *
   * When memory is ON:   profile + long-term memories + recent chat summaries
   * When memory is OFF:  profile only (clean prompt, predictable tokens for paid APIs)
   */
  private buildSystemPrompt(
    user: UserRow | undefined,
    convoId: string,
    memoryEnabled: boolean,
    agentInstructions?: string,
    availableTools?: { name: string; description: string }[],
  ): string {
    // Agent instructions take priority — they define the persona
    const lines = agentInstructions
      ? [agentInstructions]
      : [
          "You are Enzo AI, a helpful, concise, locally-running AI assistant.",
          "You run entirely on the user's own machine and value their privacy.",
        ];

    // Always fence code so the UI can render proper syntax-highlighted blocks.
    lines.push("When you include code, always wrap it in a fenced code block with the language, e.g. ```python ... ```. Use Markdown for formatting.");

    if (user) {
      lines.push(`The person you are assisting goes by "${user.username}".`);
      if (user.super_powers)
        lines.push(`Their areas of expertise: ${user.super_powers}.`);
      if (user.about)
        lines.push(`About them: ${user.about}`);
      if (user.assistant_style)
        lines.push(`They prefer responses like this: ${user.assistant_style}`);
    }

    // ── Describe available tools ───────────────────────────────────────────
    if (availableTools && availableTools.length > 0) {
      lines.push("\n\nYou have access to these tools:");
      for (const t of availableTools) lines.push(`- ${t.name}: ${t.description}`);
      lines.push(
        "Tool-use rules: Only call a tool when the user asks you to perform an action or to fetch information you do not already have — e.g. run a calculation they gave you, read a file or URL they referenced, search the web, or check the current date/time. " +
        "For explaining, summarizing, writing, reviewing, or discussing code or concepts, answer directly from your own knowledge — do NOT call any tool. " +
        "If the user asks what tools or capabilities you have, just describe the ones listed above by name without calling them, and never claim tools that are not listed. " +
        "Never write a tool or function call as part of your reply: do not output JSON such as {\"name\": ...}, and do not write tool_name(...) call syntax. Tools are executed by the system automatically — your reply to the user must always be plain natural language, using Markdown and fenced code blocks for any code.",
      );
    } else {
      lines.push("\n\nYou have no tools enabled for this chat. If asked what tools you have, say so plainly and do not invent any.");
    }

    if (!user || !memoryEnabled) return lines.join(" ");

    // ── Inject durable personal memories ONLY ──────────────────────────────
    // Facts / preferences / decisions about the *person* — deliberately NOT
    // summaries of other chats, which caused unrelated conversations to bleed
    // into new ones. `work_context` is per-chat activity, so it's excluded too:
    // each chat keeps its own conversation context, while personalization stays.
    const memories = this.memoriesService
      .recent(user.id, 8)
      .filter((m) => m.type !== "work_context");
    if (memories.length > 0) {
      lines.push("\n\nWhat you remember about this person:");
      for (const m of memories) {
        lines.push(`- [${m.type}] ${m.content}`);
      }
    }

    return lines.join(" ");
  }

  /**
   * Scan text for every balanced top-level `{ ... }` JSON object, respecting
   * string literals so braces inside strings don't throw off the depth count.
   * Handles bare objects and objects with nested arguments alike.
   */
  private extractJsonObjects(text: string): string[] {
    const objs: string[] = [];
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === "{") { if (depth === 0) start = i; depth++; }
      else if (ch === "}") {
        if (depth > 0 && --depth === 0 && start >= 0) {
          objs.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
    return objs;
  }

  /** True if a JSON snippet is a tool call for one of the available tools. */
  private isToolCallJson(snippet: string, validNames: Set<string>): boolean {
    let obj: any;
    try { obj = JSON.parse(snippet); } catch { return false; }
    return (
      !!obj &&
      typeof obj.name === "string" &&
      validNames.has(obj.name) &&
      (obj.arguments !== undefined || obj.parameters !== undefined)
    );
  }

  /**
   * Detect tool calls that a (usually small) model emitted as plain text/JSON in
   * its reply — fenced OR bare — instead of via the structured tool_calls field.
   * Only returns calls that reference a real available tool, so ordinary code or
   * JSON shown in an answer (e.g. {"name":"John Doe"}) is never mistaken for one.
   */
  private parseLeakedToolCalls(
    content: string,
    validNames: Set<string>,
  ): { name: string; args: any }[] {
    if (!content) return [];
    const out: { name: string; args: any }[] = [];
    const seen = new Set<string>();
    for (const snippet of this.extractJsonObjects(content)) {
      let obj: any;
      try { obj = JSON.parse(snippet); } catch { continue; }
      if (!obj || typeof obj.name !== "string" || !validNames.has(obj.name)) continue;
      const args = obj.arguments ?? obj.parameters ?? {};
      const key = obj.name + JSON.stringify(args);
      if (!seen.has(key)) { seen.add(key); out.push({ name: obj.name, args }); }
    }
    return out;
  }

  /** Remove any leaked tool-call JSON (fenced or bare) from a final answer so it is never shown raw. */
  private stripLeakedToolCalls(content: string, validNames: Set<string>): string {
    if (!content) return content;
    let out = content;
    for (const snippet of this.extractJsonObjects(content)) {
      if (this.isToolCallJson(snippet, validNames)) out = out.split(snippet).join("");
    }
    return out
      .replace(/```[a-zA-Z]*\s*```/g, "") // empty fenced blocks left behind
      .replace(/\n{3,}/g, "\n\n")
      .trim();
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

  /** Save an uploaded document's original bytes so the user can download it later. */
  async saveAttachment(messageId: string, buffer: Buffer): Promise<void> {
    const uploadsDir = path.join(config.dataDir, "uploads");
    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(path.join(uploadsDir, `${messageId}.attach`), buffer);
  }

  /** Load a stored document's original bytes for download, or null if missing. */
  async getAttachmentBuffer(messageId: string): Promise<Buffer | null> {
    const filePath = path.join(config.dataDir, "uploads", `${messageId}.attach`);
    try { return await fs.readFile(filePath); } catch { return null; }
  }

  /** Frame an attached document's extracted text for the model, capping length. */
  private inlineAttachment(name: string | null, text: string): string {
    const MAX = 60_000; // ~15k tokens — keep the chat from overflowing context
    let body = text;
    let note = "";
    if (body.length > MAX) { body = body.slice(0, MAX); note = "\n\n[… document truncated …]"; }
    return `The user attached a document "${name ?? "document"}". Its full contents:\n\n"""\n${body}${note}\n"""\n\n`;
  }

  async *streamReply(
    convo: ChatRow,
    userId: string,
    content: string,
    requestedModel: string | undefined,
    signal: AbortSignal,
    imageBase64?: string,
    imageMime?: string,
    // Attached document (PDF/Word/Excel/text). Its text is extracted, stored on
    // the message, and inlined into the model's context every turn.
    attachment?: { base64: string; mime: string; name: string },
    // Where this message came from ("telegram"/"discord"/"slack" for inbound
    // platform messages, undefined for the web UI). Used to avoid echoing a
    // reply back to the platform that already received it via its own handler.
    origin?: string,
  ): AsyncIterable<ChatEvent> {
    // Encryption gate: refuse to read/write chats while the vault is locked.
    if (this.vault.isConfigured() && !this.vault.isUnlocked()) {
      yield { error: "🔒 Chats are locked. Enter your passphrase to unlock." };
      yield { done: true };
      return;
    }
    // Load attached agent (if any)
    const agent = (convo as any).agent_id
      ? this.agentsService.get((convo as any).agent_id, userId) ?? null
      : null;
    // With an agent attached, use exactly its configured tool list. For a plain
    // chat (no agent), expose all admin-enabled, connection-ready tools.
    const agentTools = agent
      ? (JSON.parse(agent.tools) as ToolName[])
      : this.toolsService.getChatToolNames(userId);

    const model = requestedModel || agent?.model || convo.model || this.settings.getDefaultModel();
    this.convos.setModel(convo.id, model);

    const memoryEnabled = convo.memory_enabled !== 0;
    const user = this.users.findById(userId);

    // Extract text from an attached document before persisting the message, so
    // a parse failure surfaces to the user instead of saving a broken message.
    let attachmentMeta: { name: string; mime: string; text: string } | undefined;
    let attachmentBuffer: Buffer | undefined;
    if (attachment?.base64 && attachment.name) {
      attachmentBuffer = Buffer.from(attachment.base64, "base64");
      try {
        const text = await extractDocumentText(attachmentBuffer, attachment.mime, attachment.name);
        attachmentMeta = { name: attachment.name, mime: attachment.mime, text };
      } catch (err) {
        yield { error: `📎 ${(err as Error).message}` };
        yield { done: true };
        return;
      }
    }

    const userMsg = this.convos.addMessage(convo.id, "user", content, imageMime, attachmentMeta);
    if (imageBase64 && imageMime) {
      await this.saveImage(userMsg.id, imageBase64, imageMime);
    }
    if (attachmentBuffer) {
      await this.saveAttachment(userMsg.id, attachmentBuffer);
    }

    const allMessages = this.convos.listMessages(convo.id);
    // Build history; inline attached-document text and load image data from disk
    // so providers can use them.
    const history: ChatMessage[] = await Promise.all(
      allMessages.map(async (m) => {
        const text = m.attachment_text
          ? this.inlineAttachment(m.attachment_name, m.attachment_text) + m.content
          : m.content;
        const base: ChatMessage = { role: m.role as any, content: text };
        if (m.image_mime) {
          const data = await this.loadImage(m.id, m.image_mime);
          if (data) { base.imageData = data; base.imageMime = m.image_mime; }
        }
        return base;
      }),
    );

    // Resolve the tools available this turn so we can both describe them in the
    // system prompt (so the model can answer "what can you do?") and offer them
    // for function-calling below.
    const builtinDefs = this.toolsService.getDefinitions(agentTools);
    // Agents always get tools; agent-less chats only when the admin enabled it
    // (mirrors getChatToolNames). Skipping MCP here keeps plain chats on the
    // fast streaming path instead of the non-streaming tool-detection loop.
    const chatToolsAllowed = agent != null || this.settings.getChatToolsEnabled();
    const mcpTools = chatToolsAllowed
      ? await this.mcpService.getToolsForUser(userId).catch(() => [])
      : [];
    const availableTools = [...builtinDefs, ...mcpTools].map((d) => ({
      name: d.function.name,
      description: d.function.description,
    }));

    let systemPrompt = this.buildSystemPrompt(
      user, convo.id, memoryEnabled, agent?.instructions, availableTools,
    );

    // Retrieval-augmented generation: if a knowledge base is attached to this
    // chat (or its agent), pull the most relevant chunks for the user's message
    // and inject them into the system prompt.
    const kbId =
      ((convo as any).knowledge_base_id as string | null | undefined) ||
      (agent ? ((agent as any).knowledge_base_id as string | null | undefined) : null) ||
      null;
    if (kbId) {
      const ragContext = await this.knowledge.retrieveContext(kbId, userId, content);
      if (ragContext) systemPrompt += ragContext;
    }

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
      const hasMcpTools = mcpTools.length > 0;

      if ((agentTools.length > 0 || hasMcpTools) && provider.id === "ollama") {
        // Strip _mcp metadata before sending to LLM (it only needs type/function)
        const mcpDefs = mcpTools.map(({ type, function: fn }) => ({ type, function: fn }));
        const toolDefs = [...builtinDefs, ...mcpDefs];
        const validNames = new Set<string>(
          toolDefs.map((d: any) => d.function?.name).filter(Boolean),
        );
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

          const nativeCalls = (msg?.tool_calls ?? []).map((tc: any) => ({
            name: tc.function?.name as string,
            args: tc.function?.arguments ?? {},
          }));
          // Small local models often print a tool call as raw JSON in the text
          // instead of using the structured tool_calls field. Recover those so
          // the tool actually runs and the JSON never reaches the user — rather
          // than dumping JSON into the chat or silently dropping a real request.
          const leakedCalls = nativeCalls.length
            ? []
            : this.parseLeakedToolCalls(msg?.content ?? "", validNames);
          const toolCalls = nativeCalls.length ? nativeCalls : leakedCalls;

          if (!toolCalls.length) {
            // No tool calls — this is the final answer. Strip any stray
            // tool-call JSON the model may have left behind, then stream it.
            assistant = this.stripLeakedToolCalls(msg?.content ?? "", validNames);
            if (assistant) {
              for (const char of assistant) { yield { token: char }; }
            }
            break;
          }

          // Record the assistant turn. For leaked (text) calls we drop the raw
          // JSON content so it is never re-fed to the model or shown to the user.
          loopMessages.push({ role: "assistant", content: leakedCalls.length ? "" : (msg.content ?? "") });
          for (const tc of toolCalls) {
            const toolName = tc.name;
            const toolArgs = tc.args ?? {};
            this.logger.debug(`Tool call: ${toolName}(${JSON.stringify(toolArgs)})`);
            yield { token: `\n\`🔧 ${toolName}\`\n` };
            let result: string;
            if (this.mcpService.isMcpTool(toolName)) {
              result = await this.mcpService.callTool(userId, toolName, toolArgs);
            } else {
              result = await this.toolsService.execute(toolName, toolArgs, userId);
            }
            loopMessages.push({ role: "tool", content: result } as any);
          }
        }

        // Safety net: if no prose was produced (the model leaked a tool call as
        // text, or the loop exhausted its rounds still calling tools), make one
        // final tool-free request so the user always gets a clean reply. Done
        // non-streaming so any residual leaked JSON is stripped before sending.
        if (!assistant) {
          const cleanMessages = [
            ...loopMessages,
            { role: "system", content: "Reply to the user now in plain natural language. Do not call any tool and do not output any JSON — just answer the question directly, using Markdown and fenced code blocks for any code." },
          ];
          const res2 = await fetch("http://127.0.0.1:11434/api/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: model.replace(/^ollama:/, ""), messages: cleanMessages, stream: false }),
            signal,
          });
          if (res2.ok) {
            const d2 = await res2.json() as any;
            assistant = this.stripLeakedToolCalls(d2?.message?.content ?? "", validNames);
            if (assistant) {
              for (const char of assistant) { yield { token: char }; }
            }
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

      // If this chat is linked to an integration and the message did NOT
      // originate from that integration (i.e. it was sent from the web UI),
      // push the assistant reply out to the platform so both sides stay in sync.
      const integration = (convo as any).connection as string | null;
      if (integration && integration !== origin && this.relayToIntegration) {
        this.relayToIntegration(integration, userId, convo.id, assistant).catch((e) =>
          this.logger.error(`Failed to relay reply to ${integration}: ${e.message}`),
        );
      }

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
   * Process a message in an existing chat and return the complete reply.
   * Used by Telegram, CLI, and other non-streaming clients.
   */
  async processMessage(userId: string, convoId: string, content: string, model?: string, origin?: string): Promise<string> {
    const convo = this.convos.get(convoId, userId);
    if (!convo) throw new Error(`Chat ${convoId} not found for user ${userId}`);
    const controller = new AbortController();
    let reply = "";
    for await (const event of this.streamReply(convo, userId, content, model, controller.signal, undefined, undefined, undefined, origin)) {
      if (event.token) reply += event.token;
      if (event.error) throw new Error(event.error);
    }
    return reply || "No response";
  }

  /** Run an agent's scheduled prompt as a background chat (result saved to memories). Returns the result text. */
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
