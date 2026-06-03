import { Injectable, Logger } from "@nestjs/common";
import { config } from "../config";
import { SettingsService } from "../settings/settings.service";
import { MemoriesService } from "./memories.service";
import type { MessageRow, MemoryType } from "../database/database.types";

const MIN_EXCHANGES = 4; // minimum user+assistant pairs before extraction

/** Prompts — kept short so even a 3B model handles them reliably. */
const SUMMARY_PROMPT = (messages: string) => `
Summarize the following conversation in 2-3 sentences.
Focus on what was worked on, decided, or learned. Be specific and concise.
Do not mention greetings or small talk.

Conversation:
${messages}

Summary:`.trim();

const EXTRACT_PROMPT = (messages: string) => `
Based on the following conversation, extract at most 3 pieces of information
worth remembering long-term about the person. Be very selective — only durable,
useful facts. If nothing worth keeping, return [].

Types:
- fact: stable fact about the person (job, project, technology they use)
- decision: something they decided or chose
- preference: how they like things done
- work_context: current project or work focus

Return ONLY a JSON array, no other text:
[{"type":"fact|decision|preference|work_context","content":"one clear sentence"}]

Conversation:
${messages}

JSON:`.trim();

@Injectable()
export class MemoryExtractionService {
  private readonly logger = new Logger(MemoryExtractionService.name);

  constructor(
    private readonly memories: MemoriesService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Returns true if a conversation has enough content to be worth extracting
   * and hasn't been summarised yet.
   */
  shouldExtract(conversationId: string, messages: MessageRow[]): boolean {
    if (this.memories.hasSummary(conversationId)) return false;
    const exchanges = messages.filter(
      (m) => m.role === "user" || m.role === "assistant",
    ).length;
    return exchanges >= MIN_EXCHANGES;
  }

  /**
   * Fire-and-forget extraction — never awaited by the chat route.
   * Always uses the local Ollama model regardless of which model the
   * conversation is using (we never send user data to a paid API for this).
   */
  extractInBackground(
    conversationId: string,
    userId: string,
    messages: MessageRow[],
  ): void {
    // Deliberately not awaited — runs as a detached microtask
    this.runExtraction(conversationId, userId, messages).catch((err) =>
      this.logger.warn(`Memory extraction failed for ${conversationId}: ${err.message}`),
    );
  }

  private async runExtraction(
    conversationId: string,
    userId: string,
    messages: MessageRow[],
  ): Promise<void> {
    const model = this.settings.getDefaultModel();
    const ollamaUrl = config.ollamaUrl;

    // Format messages for the prompts (exclude system messages)
    const formatted = messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role === "user" ? "User" : "Enzo"}: ${m.content}`)
      .join("\n");

    // 1. Generate summary
    const summary = await this.callOllama(ollamaUrl, model, SUMMARY_PROMPT(formatted));
    if (summary) {
      this.memories.saveSummary(conversationId, summary);
      this.logger.debug(`Summary saved for conversation ${conversationId}`);
    }

    // 2. Extract long-term memories
    const raw = await this.callOllama(ollamaUrl, model, EXTRACT_PROMPT(formatted));
    if (!raw) return;

    let extracted: { type: MemoryType; content: string }[] = [];
    try {
      // Find the JSON array in the response (model may add preamble)
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) extracted = JSON.parse(match[0]);
    } catch {
      this.logger.warn(`Could not parse memory JSON for ${conversationId}: ${raw.slice(0, 100)}`);
      return;
    }

    const validTypes: MemoryType[] = ["fact", "decision", "preference", "work_context"];
    let saved = 0;
    for (const item of extracted.slice(0, 3)) {
      if (
        item?.content?.trim() &&
        validTypes.includes(item.type as MemoryType)
      ) {
        this.memories.add(userId, item.type as MemoryType, item.content, conversationId);
        saved++;
      }
    }
    if (saved > 0) {
      this.logger.debug(`Extracted ${saved} memories from conversation ${conversationId}`);
    }
  }

  /** Simple non-streaming Ollama call for extraction (short input/output). */
  private async callOllama(
    baseUrl: string,
    model: string,
    prompt: string,
  ): Promise<string> {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Ollama generate failed: ${res.status}`);
    const data = await res.json() as { response?: string };
    return (data.response ?? "").trim();
  }
}
