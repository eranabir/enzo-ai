export type Role = "system" | "user" | "assistant";

export interface Message {
  id: string;
  chat_id: string;
  role: Role;
  content: string;
  image_mime?: string | null;
  created_at: number;
}

export type MemoryType = "fact" | "decision" | "preference" | "work_context";

export type ToolName = "get_datetime" | "calculator" | "web_search" | "read_url" | "git";

export interface Agent {
  id: string;
  name: string;
  emoji: string;
  description: string | null;
  instructions: string;
  model: string | null;
  tools: ToolName[];
  schedule: string | null;
  schedulePrompt: string | null;
  scheduleEnabled: boolean;
  telegramChatIds: string; // comma-separated Telegram chat IDs
  knowledgeBaseId: string | null;
  lastRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeBase {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  embedding_model: string;
  created_at: number;
  document_count: number;
}

export interface KnowledgeDocument {
  id: string;
  kb_id: string;
  title: string;
  source_type: string;
  source_ref: string | null;
  status: string;
  error: string | null;
  chunk_count: number;
  created_at: number;
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  enabled: boolean;
  /** Account this tool needs connected (e.g. "google"); undefined = system tool. */
  requiresConnection?: string;
  /** Whether the required account is currently connected. */
  connected?: boolean;
}

export interface McpServer {
  id: string;
  user_id: string;
  name: string;
  type: "stdio" | "http";
  command: string | null;
  args: string[];
  env: Record<string, string>;
  url: string | null;
  enabled: boolean;
  created_at: number;
}

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  sourceChatId: string | null;
  createdAt: number;
}

export interface Chat {
  id: string;
  title: string;
  model: string | null;
  memory_enabled: number; // 1 = on, 0 = off (SQLite boolean)
  connection: string | null; // "telegram" | null — managed by a connection
  created_at: number;
  updated_at: number;
}

export interface ChatDetail extends Chat {
  messages: Message[];
}

export interface ModelInfo {
  id: string;
  provider: string;
  label?: string;
  supportsTools?: boolean;
  supportsVision?: boolean;
}

/** Hardware info + recommended model returned by GET /api/system. */
export interface SystemInfo {
  os: string;
  arch: string;
  cpuCount: number;
  cpuModel: string;
  ramGb: number;
  vramGb: number | null;
  gpuName: string | null;
  detectionMethod: string;
}

export interface ModelRecommendation {
  modelId: string;
  label: string;
  reason: string;
  vramRequired: number | null;
  alternatives: { modelId: string; label: string; note: string }[];
  alreadyInstalled: boolean;
}

export interface SystemAnalysis {
  info: SystemInfo;
  recommendation: ModelRecommendation;
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
