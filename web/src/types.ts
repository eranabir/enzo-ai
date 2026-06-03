export type Role = "system" | "user" | "assistant";

export interface Message {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  created_at: number;
}

export type MemoryType = "fact" | "decision" | "preference" | "work_context";

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  sourceConversationId: string | null;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string | null;
  memory_enabled: number; // 1 = on, 0 = off (SQLite boolean)
  created_at: number;
  updated_at: number;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface ModelInfo {
  id: string;
  provider: string;
  label?: string;
}

export type UserRole = "admin" | "user";

export interface User {
  id: string;
  username: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  superPowers: string | null;
  about: string | null;
  assistantStyle: string | null;
  hasPin: boolean;
  role: UserRole;
  isAdmin: boolean;
}

export interface ProfileSummary {
  id: string;
  username: string;
  displayName: string;
  hasPin: boolean;
  role: UserRole;
}
