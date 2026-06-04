export type Role = "system" | "user" | "assistant";
export type MemoryType = "fact" | "decision" | "preference" | "work_context";

export interface ConversationRow {
  id: string;
  user_id: string | null;
  title: string;
  model: string | null;
  memory_enabled: number; // SQLite boolean: 1 = on, 0 = off
  integration: string | null; // e.g. "telegram" — managed by an integration
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  image_mime: string | null;
  created_at: number;
}

export interface MemoryRow {
  id: string;
  user_id: string;
  type: MemoryType;
  content: string;
  source_conversation_id: string | null;
  created_at: number;
}

export interface ConversationSummaryRow {
  conversation_id: string;
  summary: string;
  created_at: number;
}
