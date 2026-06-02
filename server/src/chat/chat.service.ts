import { Injectable } from "@nestjs/common";
import { config } from "../config";
import { ConversationsService } from "../conversations/conversations.service";
import { LlmService } from "../llm/llm.service";
import { UsersService } from "../users/users.service";
import type { ChatMessage } from "../llm/provider.types";
import type { ConversationRow } from "../database/database.types";
import type { UserRow } from "../users/users.types";

/** One streamed event sent to the UI over SSE. */
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
  ) {}

  /** Build the system prompt, personalised with the user's profile. */
  private systemPrompt(user: UserRow | undefined): string {
    const lines = [
      "You are Enzo, a helpful, concise, locally-running AI assistant.",
      "You run entirely on the user's own machine and value their privacy.",
    ];
    if (user) {
      lines.push(`The person you are assisting is named ${user.display_name}.`);
      if (user.about) lines.push(`About them: ${user.about}`);
      if (user.assistant_style)
        lines.push(`They prefer that you respond like this: ${user.assistant_style}`);
    }
    return lines.join(" ");
  }

  /**
   * Stream the assistant reply for a user message, persisting both sides to
   * local memory as it goes. Yields SSE-ready events.
   */
  async *streamReply(
    convo: ConversationRow,
    userId: string,
    content: string,
    requestedModel: string | undefined,
    signal: AbortSignal,
  ): AsyncIterable<ChatEvent> {
    const model = requestedModel || convo.model || config.defaultModel;
    this.convos.setModel(convo.id, model);

    // Persist the user message, then build the context window from history.
    this.convos.addMessage(convo.id, "user", content);
    const history: ChatMessage[] = this.convos
      .listMessages(convo.id)
      .map((m) => ({ role: m.role, content: m.content }));

    const messages: ChatMessage[] = [
      { role: "system", content: this.systemPrompt(this.users.findById(userId)) },
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
    } catch (err) {
      if (assistant) this.convos.addMessage(convo.id, "assistant", assistant);
      yield { error: (err as Error).message };
    }
  }
}
