export type Role = "system" | "user" | "assistant";

export interface ConversationRow {
  id: string;
  title: string;
  model: string | null;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  created_at: number;
}
