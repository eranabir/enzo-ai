export type Role = "system" | "user" | "assistant";
export type MemoryType = "fact" | "decision" | "preference" | "work_context";

export interface ChatRow {
  id: string;
  user_id: string | null;
  title: string;
  model: string | null;
  memory_enabled: number; // SQLite boolean: 1 = on, 0 = off
  connection: string | null; // e.g. "telegram" — managed by an connection
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  role: Role;
  content: string;
  image_mime: string | null;
  // Attached document (PDF / Word / Excel / text). attachment_text holds the
  // extracted plain text inlined into the model's context.
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_text: string | null;
  created_at: number;
}

export interface MemoryRow {
  id: string;
  user_id: string;
  type: MemoryType;
  content: string;
  source_chat_id: string | null;
  created_at: number;
}

export interface ChatSummaryRow {
  chat_id: string;
  summary: string;
  created_at: number;
}
