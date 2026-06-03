import { Injectable } from "@nestjs/common";
import { ConversationsService } from "../conversations/conversations.service";
import { LlmService } from "../llm/llm.service";
import { UsersService } from "../users/users.service";
import { SettingsService } from "../settings/settings.service";
import { MemoriesService } from "../memories/memories.service";
import { MemoryExtractionService } from "../memories/memory-extraction.service";
import type { ChatMessage } from "../llm/provider.types";
import type { ConversationRow } from "../database/database.types";
import type { UserRow } from "../users/users.types";

export interface ChatEvent {
  token?: string;
  title?: string;
  error?: string;
  done?: boolean;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly convos: ConversationsService,
    private readonly llm: LlmService,
    private readonly users: UsersService,
    private readonly settings: SettingsService,
    private readonly memoriesService: MemoriesService,
    private readonly extraction: MemoryExtractionService,
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
  ): string {
    const lines = [
      "You are Enzo, a helpful, concise, locally-running AI assistant.",
      "You run entirely on the user's own machine and value their privacy.",
    ];

    if (user) {
      const name = user.nickname || user.first_name || user.display_name;
      lines.push(`The person you are assisting is ${name}.`);
      if (user.first_name && user.last_name)
        lines.push(`Their full name is ${user.first_name} ${user.last_name}.`);
      if (user.nickname)
        lines.push(`They prefer to be called "${user.nickname}".`);
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

  async *streamReply(
    convo: ConversationRow,
    userId: string,
    content: string,
    requestedModel: string | undefined,
    signal: AbortSignal,
  ): AsyncIterable<ChatEvent> {
    const model = requestedModel || convo.model || this.settings.getDefaultModel();
    this.convos.setModel(convo.id, model);

    const memoryEnabled = convo.memory_enabled !== 0; // SQLite 0/1
    const user = this.users.findById(userId);

    this.convos.addMessage(convo.id, "user", content);
    const allMessages = this.convos.listMessages(convo.id);
    const history: ChatMessage[] = allMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const messages: ChatMessage[] = [
      { role: "system", content: this.buildSystemPrompt(user, convo.id, memoryEnabled) },
      ...history,
    ];

    const provider = this.llm.getProvider("ollama")!;
    let assistant = "";

    try {
      if (!(await this.llm.ollama.isAvailable())) {
        throw new Error(
          "Local model engine (Ollama) is not running. Start Ollama and try again.",
        );
      }
      for await (const token of provider.streamChat({ model, messages, signal })) {
        assistant += token;
        yield { token };
      }
      this.convos.addMessage(convo.id, "assistant", assistant);

      // Auto-title a brand-new conversation from its first message.
      if (convo.title === "New chat") {
        const title = content.slice(0, 60) + (content.length > 60 ? "…" : "");
        this.convos.rename(convo.id, title);
        yield { title };
      }
      yield { done: true };

      // ── Background memory extraction ─────────────────────────────────────
      // Only if memory is enabled for this conversation. Always uses the
      // local model — never a paid external API.
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
}
