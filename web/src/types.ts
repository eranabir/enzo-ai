export type Role = "system" | "user" | "assistant";

export interface Message {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  created_at: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string | null;
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

export interface User {
  id: string;
  username: string;
  displayName: string;
  about: string | null;
  assistantStyle: string | null;
  hasPin: boolean;
}

export interface ProfileSummary {
  id: string;
  username: string;
  displayName: string;
  hasPin: boolean;
}
