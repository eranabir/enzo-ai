import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { DATABASE, type DatabaseConnection } from "../database/database.module";
import { OllamaProvider } from "../llm/ollama.provider";
import { VaultService } from "../vault/vault.service";

/** Default local embedding model — multilingual (100+ languages incl. Hebrew), auto-pulled. */
const DEFAULT_EMBED_MODEL = "bge-m3";
const CHUNK_CHARS = 1200;       // ~300 tokens per chunk
const CHUNK_OVERLAP = 150;      // carry-over for context continuity
const EMBED_BATCH = 16;         // chunks per /api/embed request
const DEFAULT_TOP_K = 5;        // chunks retrieved per query

export interface KnowledgeBaseRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  embedding_model: string;
  created_at: number;
}

export interface KnowledgeDocumentRow {
  id: string;
  kb_id: string;
  user_id: string;
  title: string;
  source_type: string;
  source_ref: string | null;
  status: string;
  error: string | null;
  chunk_count: number;
  created_at: number;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    @Inject(DATABASE) private readonly db: DatabaseConnection,
    private readonly ollama: OllamaProvider,
    private readonly vault: VaultService,
  ) {}

  // ── Knowledge bases ─────────────────────────────────────────────────────────

  listBases(userId: string): (KnowledgeBaseRow & { document_count: number })[] {
    return this.db
      .prepare(
        `SELECT b.*, (SELECT COUNT(*) FROM knowledge_documents d WHERE d.kb_id = b.id) AS document_count
         FROM knowledge_bases b WHERE b.user_id = ? ORDER BY b.created_at DESC`,
      )
      .all(userId) as (KnowledgeBaseRow & { document_count: number })[];
  }

  getBase(id: string, userId: string): KnowledgeBaseRow | undefined {
    return this.db
      .prepare(`SELECT * FROM knowledge_bases WHERE id = ? AND user_id = ?`)
      .get(id, userId) as KnowledgeBaseRow | undefined;
  }

  createBase(userId: string, name: string, description?: string): KnowledgeBaseRow {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO knowledge_bases (id, user_id, name, description, embedding_model, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, name.trim(), description?.trim() || null, DEFAULT_EMBED_MODEL, now);
    return this.getBase(id, userId)!;
  }

  deleteBase(id: string, userId: string): void {
    // chunks + documents cascade via FK (ON DELETE CASCADE)
    this.db.prepare(`DELETE FROM knowledge_bases WHERE id = ? AND user_id = ?`).run(id, userId);
  }

  // ── Documents ───────────────────────────────────────────────────────────────

  listDocuments(kbId: string, userId: string): KnowledgeDocumentRow[] {
    return this.db
      .prepare(`SELECT * FROM knowledge_documents WHERE kb_id = ? AND user_id = ? ORDER BY created_at DESC`)
      .all(kbId, userId) as KnowledgeDocumentRow[];
  }

  deleteDocument(docId: string, userId: string): void {
    this.db.prepare(`DELETE FROM knowledge_documents WHERE id = ? AND user_id = ?`).run(docId, userId);
  }

  /** Edit a document's title and/or content. Changing content re-chunks + re-embeds. */
  async updateDocument(
    docId: string,
    userId: string,
    opts: { title?: string; content?: string },
  ): Promise<KnowledgeDocumentRow & { content: string }> {
    this.assertUnlocked();
    const doc = this.db
      .prepare(`SELECT * FROM knowledge_documents WHERE id = ? AND user_id = ?`)
      .get(docId, userId) as KnowledgeDocumentRow | undefined;
    if (!doc) throw new Error("Document not found");

    if (opts.title !== undefined && opts.title.trim()) {
      this.db.prepare(`UPDATE knowledge_documents SET title = ? WHERE id = ?`).run(opts.title.trim(), docId);
    }

    if (opts.content !== undefined) {
      const text = opts.content.trim();
      if (!text) throw new Error("Content cannot be empty");
      const kb = this.getBase(doc.kb_id, userId);
      if (!kb) throw new Error("Knowledge base not found");
      const chunks = this.chunk(text);
      await this.ensureEmbedModel(kb.embedding_model);
      const vectors = await this.embedBatched(kb.embedding_model, chunks);
      const now = Date.now();
      const insertChunk = this.db.prepare(
        `INSERT INTO knowledge_chunks (id, document_id, kb_id, user_id, idx, content, embedding, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const tx = this.db.transaction(() => {
        this.db.prepare(`DELETE FROM knowledge_chunks WHERE document_id = ?`).run(docId);
        chunks.forEach((c, i) => {
          insertChunk.run(randomUUID(), docId, doc.kb_id, userId, i, this.vault.encryptField(c), this.vectorToBlob(vectors[i]), now);
        });
        this.db.prepare(`UPDATE knowledge_documents SET chunk_count = ? WHERE id = ?`).run(chunks.length, docId);
      });
      tx();
    }

    return this.getDocumentContent(docId, userId);
  }

  /** Return a document plus its decrypted, in-order chunk text (for viewing). */
  getDocumentContent(docId: string, userId: string): KnowledgeDocumentRow & { content: string } {
    this.assertUnlocked();
    const doc = this.db
      .prepare(`SELECT * FROM knowledge_documents WHERE id = ? AND user_id = ?`)
      .get(docId, userId) as KnowledgeDocumentRow | undefined;
    if (!doc) throw new Error("Document not found");
    const rows = this.db
      .prepare(`SELECT content FROM knowledge_chunks WHERE document_id = ? ORDER BY idx`)
      .all(docId) as { content: string }[];
    const content = rows.map((r) => this.vault.decryptField(r.content)).join("\n\n");
    return { ...doc, content };
  }

  /**
   * Ingest a document into a knowledge base: extract text, chunk, embed, store.
   * `sourceType` is "text" (pasted contents), "file" (extracted from an upload,
   * with `sourceRef` set to the filename), or "url" (fetched + stripped).
   */
  async addDocument(
    kbId: string,
    userId: string,
    opts: { title: string; sourceType: "text" | "url" | "file"; content?: string; url?: string; sourceRef?: string },
  ): Promise<KnowledgeDocumentRow> {
    this.assertUnlocked();
    const kb = this.getBase(kbId, userId);
    if (!kb) throw new Error("Knowledge base not found");

    let text = "";
    let sourceRef: string | null = opts.sourceRef ?? null;
    if (opts.sourceType === "url") {
      if (!opts.url?.trim()) throw new Error("URL is required");
      sourceRef = opts.url.trim();
      text = await this.fetchUrlText(sourceRef);
    } else {
      text = (opts.content ?? "").trim();
    }
    if (!text) throw new Error("No text content to index");

    const chunks = this.chunk(text);
    if (chunks.length === 0) throw new Error("No text content to index");

    await this.ensureEmbedModel(kb.embedding_model);
    const vectors = await this.embedBatched(kb.embedding_model, chunks);

    const docId = randomUUID();
    const now = Date.now();
    const insertDoc = this.db.prepare(
      `INSERT INTO knowledge_documents (id, kb_id, user_id, title, source_type, source_ref, status, chunk_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
    );
    const insertChunk = this.db.prepare(
      `INSERT INTO knowledge_chunks (id, document_id, kb_id, user_id, idx, content, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction(() => {
      insertDoc.run(docId, kbId, userId, opts.title.trim() || "Untitled", opts.sourceType, sourceRef, chunks.length, now);
      chunks.forEach((c, i) => {
        insertChunk.run(
          randomUUID(), docId, kbId, userId, i,
          this.vault.encryptField(c),
          this.vectorToBlob(vectors[i]),
          now,
        );
      });
    });
    tx();
    this.logger.log(`Indexed "${opts.title}" → ${chunks.length} chunks in KB ${kbId}`);
    return this.db.prepare(`SELECT * FROM knowledge_documents WHERE id = ?`).get(docId) as KnowledgeDocumentRow;
  }

  // ── Retrieval ───────────────────────────────────────────────────────────────

  /**
   * Return the top-K most relevant chunks for a query, with cosine scores.
   * Brute-force over the KB's chunks — fine for a personal corpus.
   */
  async search(
    kbId: string,
    userId: string,
    query: string,
    k = DEFAULT_TOP_K,
  ): Promise<{ content: string; score: number; title: string }[]> {
    this.assertUnlocked();
    const kb = this.getBase(kbId, userId);
    if (!kb || !query.trim()) return [];

    await this.ensureEmbedModel(kb.embedding_model);
    const [queryVec] = await this.embedBatched(kb.embedding_model, [query]);

    const rows = this.db
      .prepare(
        `SELECT c.content, c.embedding, d.title
         FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id
         WHERE c.kb_id = ?`,
      )
      .all(kbId) as { content: string; embedding: Buffer; title: string }[];
    if (rows.length === 0) return [];

    const scored = rows.map((r) => ({
      title: r.title,
      content: r.content,
      score: cosine(queryVec, this.blobToVector(r.embedding)),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => ({
      title: s.title,
      score: s.score,
      content: this.vault.decryptField(s.content),
    }));
  }

  /**
   * Build a system-prompt context block from the most relevant chunks, or null
   * if there's nothing useful. Used by the chat service for automatic RAG.
   */
  async retrieveContext(kbId: string, userId: string, query: string, k = DEFAULT_TOP_K): Promise<string | null> {
    try {
      const hits = (await this.search(kbId, userId, query, k)).filter((h) => h.score > 0.2);
      if (hits.length === 0) return null;
      const blocks = hits.map((h, i) => `[${i + 1}] (from "${h.title}")\n${h.content}`);
      return (
        "\n\nThe following passages were just retrieved from the user's own uploaded documents because they " +
        "matched this exact question — they are real, already-confirmed-relevant source material, not optional " +
        "background. Read them fully before answering. If they contain the answer, use them directly and do not " +
        "claim you lack the information. Only say the knowledge base doesn't cover this if these passages truly " +
        "don't address the question after reading all of them.\n\n" +
        blocks.join("\n\n")
      );
    } catch (err) {
      this.logger.warn(`Knowledge retrieval failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ── Embedding model ─────────────────────────────────────────────────────────

  async embedModelStatus(): Promise<{ model: string; available: boolean }> {
    const available = await this.ollama.hasModel(DEFAULT_EMBED_MODEL).catch(() => false);
    return { model: DEFAULT_EMBED_MODEL, available };
  }

  private async ensureEmbedModel(model: string): Promise<void> {
    if (await this.ollama.hasModel(model)) return;
    this.logger.log(`Pulling embedding model "${model}" (first use)…`);
    for await (const _ of this.ollama.pullModel(model)) { /* drain progress */ }
    this.logger.log(`Embedding model "${model}" ready`);
  }

  private async embedBatched(model: string, texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      out.push(...(await this.ollama.embed(model, batch)));
    }
    return out;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private assertUnlocked(): void {
    if (this.vault.isConfigured() && !this.vault.isUnlocked()) {
      throw new Error("Chats are locked. Unlock encryption to use the knowledge base.");
    }
  }

  /** Split text into overlapping chunks, preferring paragraph/sentence breaks. */
  private chunk(text: string): string[] {
    const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (clean.length <= CHUNK_CHARS) return clean ? [clean] : [];
    const chunks: string[] = [];
    let start = 0;
    while (start < clean.length) {
      let end = Math.min(start + CHUNK_CHARS, clean.length);
      if (end < clean.length) {
        // Back off to the nearest paragraph / sentence / space boundary.
        const slice = clean.slice(start, end);
        const br = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
        if (br > CHUNK_CHARS * 0.5) end = start + br + 1;
      }
      const piece = clean.slice(start, end).trim();
      if (piece) chunks.push(piece);
      if (end >= clean.length) break;
      start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }
    return chunks;
  }

  private async fetchUrlText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 EnzoAI" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status}`);
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }

  private vectorToBlob(vec: number[]): Buffer {
    return Buffer.from(new Float32Array(vec).buffer);
  }

  private blobToVector(buf: Buffer): Float32Array {
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }
}

/** Cosine similarity between two vectors. */
function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
