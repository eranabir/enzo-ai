import type {
  Chat,
  ChatDetail,
  ModelInfo,
  ProfileSummary,
  SystemAnalysis,
  User,
} from "./types";

const TOKEN_KEY = "enzo_token";

// Guard against environments where localStorage may throw
// (strict browser privacy settings, sandboxed iframes, etc.)
function safeStorage() {
  try { return localStorage; } catch { return null; }
}

let token: string | null = safeStorage()?.getItem(TOKEN_KEY) ?? null;

export function getToken() {
  return token;
}

export function setToken(value: string | null) {
  token = value;
  try {
    const s = safeStorage();
    if (s) value ? s.setItem(TOKEN_KEY, value) : s.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

/** Build headers, including the session token when signed in. */
function headers(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["content-type"] = "application/json";
  if (token) h["x-enzo-ai-token"] = token;
  return h;
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = await res.json();
      message = body?.message || body?.error || message;
    } catch {
      /* ignore */
    }
    throw new Error(Array.isArray(message) ? message.join(", ") : message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // ---- auth ----
  profiles: () =>
    fetch("/api/auth/profiles").then(parse<ProfileSummary[]>),

  register: (body: {
    username: string;
    password: string;
    firstName?: string;
    lastName?: string;
    nickname?: string;
    superPowers?: string;
    about?: string;
    assistantStyle?: string;
    pin?: string;
  }) =>
    fetch("/api/auth/register", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(body),
    }).then(parse<{ token: string; user: User }>),

  login: (body: { username: string; password?: string; pin?: string }) =>
    fetch("/api/auth/login", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(body),
    }).then(parse<{ token: string; user: User }>),

  me: () => fetch("/api/auth/me", { headers: headers() }).then(parse<{ user: User }>),

  logout: () => fetch("/api/auth/logout", { method: "POST", headers: headers() }),

  // ---- chats ----
  listChats: () =>
    fetch("/api/chats", { headers: headers() }).then(parse<Chat[]>),

  createChat: (opts?: string | { agentId?: string; knowledgeBaseId?: string }) => {
    const body = typeof opts === "string" ? { agentId: opts } : (opts ?? {});
    return fetch("/api/chats", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(body),
    }).then(parse<Chat>);
  },

  getChat: (id: string) =>
    fetch(`/api/chats/${id}`, { headers: headers() }).then(
      parse<ChatDetail>,
    ),

  deleteChat: (id: string) =>
    fetch(`/api/chats/${id}`, { method: "DELETE", headers: headers() }),

  // ---- models (auth required — returns local + user's external providers) ----
  models: () =>
    fetch("/api/models", { headers: headers() }).then(parse<{ models: ModelInfo[]; default: string }>),

  status: () => fetch("/api/models/status").then(parse<{ ollama: boolean; models?: number }>),

  // ---- system analysis + model recommendation (auth required) ----
  system: () => fetch("/api/system", { headers: headers() }).then(parse<SystemAnalysis>),

  // ── Google Calendar ───────────────────────────────────────────────────────
  calendar: {
    status: () =>
      fetch("/api/google-calendar/status", { headers: headers() })
        .then(parse<{ available?: boolean; hasCredentials: boolean; connected: boolean; email?: string; name?: string }>),
    saveCredentials: (body: { clientId: string; clientSecret: string }) =>
      fetch("/api/google-calendar/credentials", {
        method: "PUT", headers: headers(true), body: JSON.stringify(body),
      }).then(parse<{ ok: boolean }>),
    authUrl: () =>
      fetch("/api/google-calendar/auth/url", { headers: headers() })
        .then(parse<{ url: string }>),
    disconnect: () =>
      fetch("/api/google-calendar", { method: "DELETE", headers: headers() })
        .then(parse<{ ok: boolean }>),
  },

  // ── Gmail ─────────────────────────────────────────────────────────────────
  gmail: {
    status: () =>
      fetch("/api/gmail/status", { headers: headers() })
        .then(parse<{ available?: boolean; hasCredentials: boolean; connected: boolean; email?: string; name?: string }>),
    saveCredentials: (body: { clientId: string; clientSecret: string }) =>
      fetch("/api/gmail/credentials", {
        method: "PUT", headers: headers(true), body: JSON.stringify(body),
      }).then(parse<{ ok: boolean }>),
    authUrl: () =>
      fetch("/api/gmail/auth/url", { headers: headers() })
        .then(parse<{ url: string }>),
    disconnect: () =>
      fetch("/api/gmail", { method: "DELETE", headers: headers() })
        .then(parse<{ ok: boolean }>),
  },

  // ── Vault (encryption) ─────────────────────────────────────────────────────
  vault: {
    status: () =>
      fetch("/api/vault/status", { headers: headers() })
        .then(parse<{ configured: boolean; unlocked: boolean }>),
    setup: (passphrase: string) =>
      fetch("/api/vault/setup", { method: "POST", headers: headers(true), body: JSON.stringify({ passphrase }) })
        .then(parse<{ ok: boolean; recoveryKey: string; configured: boolean; unlocked: boolean }>),
    unlock: (secret: string) =>
      fetch("/api/vault/unlock", { method: "POST", headers: headers(true), body: JSON.stringify({ secret }) })
        .then(parse<{ ok: boolean; configured: boolean; unlocked: boolean }>),
    lock: () =>
      fetch("/api/vault/lock", { method: "POST", headers: headers() })
        .then(parse<{ ok: boolean; configured: boolean; unlocked: boolean }>),
    changePassphrase: (passphrase: string) =>
      fetch("/api/vault/change-passphrase", { method: "POST", headers: headers(true), body: JSON.stringify({ passphrase }) })
        .then(parse<{ ok: boolean }>),
  },

  // ── MCP Servers ──────────────────────────────────────────────────────────
  mcp: {
    list: () =>
      fetch("/api/mcp/servers", { headers: headers() })
        .then(parse<import("./types").McpServer[]>),
    create: (body: { name: string; type: "stdio" | "http"; command?: string; args?: string[]; env?: Record<string, string>; url?: string }) =>
      fetch("/api/mcp/servers", { method: "POST", headers: headers(true), body: JSON.stringify(body) })
        .then(parse<import("./types").McpServer>),
    update: (id: string, body: Partial<{ name: string; type: "stdio" | "http"; command: string; args: string[]; env: Record<string, string>; url: string; enabled: boolean }>) =>
      fetch(`/api/mcp/servers/${id}`, { method: "PATCH", headers: headers(true), body: JSON.stringify(body) })
        .then(parse<import("./types").McpServer>),
    delete: (id: string) =>
      fetch(`/api/mcp/servers/${id}`, { method: "DELETE", headers: headers() })
        .then(parse<{ ok: boolean }>),
    connect: (id: string) =>
      fetch(`/api/mcp/servers/${id}/connect`, { method: "POST", headers: headers() })
        .then(parse<{ ok: boolean; toolCount: number; tools: string[] }>),
  },

  knowledge: {
    status: () =>
      fetch("/api/knowledge/status", { headers: headers() })
        .then(parse<{ model: string; available: boolean }>),
    listBases: () =>
      fetch("/api/knowledge/bases", { headers: headers() })
        .then(parse<import("./types").KnowledgeBase[]>),
    createBase: (body: { name: string; description?: string }) =>
      fetch("/api/knowledge/bases", { method: "POST", headers: headers(true), body: JSON.stringify(body) })
        .then(parse<import("./types").KnowledgeBase>),
    deleteBase: (id: string) =>
      fetch(`/api/knowledge/bases/${id}`, { method: "DELETE", headers: headers() }).then(() => {}),
    listDocuments: (kbId: string) =>
      fetch(`/api/knowledge/bases/${kbId}/documents`, { headers: headers() })
        .then(parse<import("./types").KnowledgeDocument[]>),
    addDocument: (kbId: string, body: {
      title?: string; sourceType: "text" | "url" | "file"; content?: string; url?: string;
      filename?: string; mime?: string; base64?: string;
    }) =>
      fetch(`/api/knowledge/bases/${kbId}/documents`, { method: "POST", headers: headers(true), body: JSON.stringify(body) })
        .then(parse<import("./types").KnowledgeDocument>),
    getDocument: (id: string) =>
      fetch(`/api/knowledge/documents/${id}`, { headers: headers() })
        .then(parse<import("./types").KnowledgeDocument & { content: string }>),
    updateDocument: (id: string, body: { title?: string; content?: string }) =>
      fetch(`/api/knowledge/documents/${id}`, { method: "PATCH", headers: headers(true), body: JSON.stringify(body) })
        .then(parse<import("./types").KnowledgeDocument & { content: string }>),
    deleteDocument: (id: string) =>
      fetch(`/api/knowledge/documents/${id}`, { method: "DELETE", headers: headers() }).then(() => {}),
  },

  /** Which integrations are currently connected (used by AgentsPanel). */
  integrations: () =>
    fetch("/api/health/integrations", { headers: headers() })
      .then(parse<{ telegram: boolean; discord: boolean; slack: boolean }>),

  // ---- agents ----
  agents: {
    list: () => fetch("/api/agents", { headers: headers() }).then(parse<import("./types").Agent[]>),
    get: (id: string) => fetch(`/api/agents/${id}`, { headers: headers() }).then(parse<import("./types").Agent>),
    create: (body: Partial<import("./types").Agent> & { name: string; instructions: string }) =>
      fetch("/api/agents", { method: "POST", headers: headers(true), body: JSON.stringify(body) }).then(parse<import("./types").Agent>),
    update: (id: string, body: Partial<import("./types").Agent>) =>
      fetch(`/api/agents/${id}`, { method: "PATCH", headers: headers(true), body: JSON.stringify(body) }).then(parse<import("./types").Agent>),
    delete: (id: string) => fetch(`/api/agents/${id}`, { method: "DELETE", headers: headers() }),
    tools: () => fetch("/api/agents/tools", { headers: headers() }).then(parse<import("./types").ToolDefinition[]>),

    // Named secrets (e.g. a trading platform API key) scoped to one agent —
    // vault-encrypted server-side; values are never returned, only metadata.
    listCredentials: (agentId: string) =>
      fetch(`/api/agents/${agentId}/credentials`, { headers: headers() })
        .then(parse<{ id: string; name: string; createdAt: number }[]>),
    addCredential: (agentId: string, body: { name: string; value: string }) =>
      fetch(`/api/agents/${agentId}/credentials`, { method: "POST", headers: headers(true), body: JSON.stringify(body) })
        .then(parse<{ id: string; name: string; createdAt: number }>),
    removeCredential: (agentId: string, credId: string) =>
      fetch(`/api/agents/${agentId}/credentials/${credId}`, { method: "DELETE", headers: headers() }),
  },

  // ---- api keys ----
  keys: {
    list: () =>
      fetch("/api/keys", { headers: headers() }).then(parse<{ configured: string[] }>),
    save: (provider: string, key: string) =>
      fetch(`/api/keys/${provider}`, {
        method: "PUT",
        headers: headers(true),
        body: JSON.stringify({ key }),
      }).then(parse<{ ok: boolean }>),
    remove: (provider: string) =>
      fetch(`/api/keys/${provider}`, { method: "DELETE", headers: headers() }),
  },

  // ---- memories ----
  memories: {
    list: () =>
      fetch("/api/memories", { headers: headers() }).then(parse<import("./types").Memory[]>),
    deleteOne: (id: string) =>
      fetch(`/api/memories/${id}`, { method: "DELETE", headers: headers() }),
    clearAll: () =>
      fetch("/api/memories", { method: "DELETE", headers: headers() }),
  },

  // ---- chats: toggle memory ----
  setMemory: (chatId: string, enabled: boolean) =>
    fetch(`/api/chats/${chatId}`, {
      method: "PATCH",
      headers: headers(true),
      body: JSON.stringify({ memoryEnabled: enabled }),
    }).then(parse<import("./types").Chat>),

  // ---- chats: attach a local project folder (file/git tools) ----
  setFolderPath: (chatId: string, folderPath: string | null) =>
    fetch(`/api/chats/${chatId}`, {
      method: "PATCH",
      headers: headers(true),
      body: JSON.stringify({ folderPath }),
    }).then(parse<import("./types").Chat>),

  checkFolder: (folderPath: string) =>
    fetch(`/api/chats/check-folder?path=${encodeURIComponent(folderPath)}`, { headers: headers() })
      .then(parse<{
        exists: boolean; isDirectory: boolean; isGit: boolean; branch: string | null;
        diffStat: { insertions: number; deletions: number } | null;
      }>),

  /** List subfolders of a directory for the "attach project folder" browser.
   *  Omit path to start from the home directory. */
  browseFolder: (path?: string) =>
    fetch(`/api/chats/browse-folder${path ? `?path=${encodeURIComponent(path)}` : ""}`, { headers: headers() })
      .then(parse<{ path: string; parent: string | null; folders: string[] }>),

  // ---- admin ----
  admin: {
    listUsers: () =>
      fetch("/api/admin/users", { headers: headers() }).then(parse<User[]>),

    deleteUser: (id: string) =>
      fetch(`/api/admin/users/${id}`, { method: "DELETE", headers: headers() }).then(parse<{ ok: boolean }>),

    resetPassword: (id: string, password: string) =>
      fetch(`/api/admin/users/${id}/password`, {
        method: "PUT",
        headers: headers(true),
        body: JSON.stringify({ password }),
      }).then(parse<{ ok: boolean }>),

    listModels: () =>
      fetch("/api/admin/models", { headers: headers() }).then(
        parse<{ models: ModelInfo[]; ollamaOnline: boolean; defaultModel: string }>
      ),

    setDefaultModel: (model: string) =>
      fetch("/api/admin/models/default", {
        method: "PUT",
        headers: headers(true),
        body: JSON.stringify({ model }),
      }).then(parse<{ defaultModel: string }>),

    deleteModel: (name: string) =>
      fetch(`/api/admin/models/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: headers(),
      }).then(parse<{ ok: boolean }>),

    getSettings: () =>
      fetch("/api/admin/settings", { headers: headers() })
        .then(parse<{ defaultModel: string; chatToolsEnabled: boolean }>),

    updateSettings: (body: { chatToolsEnabled?: boolean }) =>
      fetch("/api/admin/settings", { method: "PATCH", headers: headers(true), body: JSON.stringify(body) })
        .then(parse<{ defaultModel: string; chatToolsEnabled: boolean }>),

    listTools: () =>
      fetch("/api/admin/tools", { headers: headers() })
        .then(parse<import("./types").ToolDefinition[]>),

    setToolEnabled: (name: string, enabled: boolean) =>
      fetch(`/api/admin/tools/${name}`, {
        method: "PATCH",
        headers: headers(true),
        body: JSON.stringify({ enabled }),
      }).then(parse<import("./types").ToolDefinition[]>),

    listConnections: () =>
      fetch("/api/admin/connections", { headers: headers() })
        .then(parse<{ id: string; name: string; enabled: boolean }[]>),

    setConnectionEnabled: (id: string, enabled: boolean) =>
      fetch(`/api/admin/connections/${id}`, {
        method: "PATCH",
        headers: headers(true),
        body: JSON.stringify({ enabled }),
      }).then(parse<{ id: string; name: string; enabled: boolean }[]>),

  },

  // ---- Per-user integrations ----
  telegram: {
    status: () =>
      fetch("/api/integrations/telegram", { headers: headers() })
        .then(parse<{ available: boolean; enabled: boolean; username: string | null; token: string | null; allowedIds: string; model: string }>),
    save: (body: { token?: string; allowedIds?: string; model?: string }) =>
      fetch("/api/integrations/telegram", { method: "PUT", headers: headers(true), body: JSON.stringify(body) })
        .then(parse<{ ok: boolean; running: boolean; username?: string }>),
    disconnect: () =>
      fetch("/api/integrations/telegram", { method: "DELETE", headers: headers() })
        .then(parse<{ ok: boolean; running: boolean }>),
  },

  discord: {
    status: () =>
      fetch("/api/integrations/discord", { headers: headers() })
        .then(parse<{ available: boolean; enabled: boolean; tag: string | null; token: string | null; allowedIds: string; model: string }>),
    save: (body: { token?: string; allowedIds?: string; model?: string }) =>
      fetch("/api/integrations/discord", { method: "PUT", headers: headers(true), body: JSON.stringify(body) })
        .then(parse<{ ok: boolean; running: boolean; tag?: string }>),
    disconnect: () =>
      fetch("/api/integrations/discord", { method: "DELETE", headers: headers() })
        .then(parse<{ ok: boolean; running: boolean }>),
  },

  slack: {
    status: () =>
      fetch("/api/integrations/slack", { headers: headers() })
        .then(parse<{ available: boolean; enabled: boolean; botName: string | null; botToken: string | null; appToken: string | null; allowedIds: string; model: string }>),
    save: (body: { botToken?: string; appToken?: string; allowedIds?: string; model?: string }) =>
      fetch("/api/integrations/slack", { method: "PUT", headers: headers(true), body: JSON.stringify(body) })
        .then(parse<{ ok: boolean; running: boolean; botName?: string }>),
    disconnect: () =>
      fetch("/api/integrations/slack", { method: "DELETE", headers: headers() })
        .then(parse<{ ok: boolean; running: boolean }>),
  },
};

export interface ChatHandlers {
  onToken: (token: string) => void;
  onTitle?: (title: string) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

/**
 * Stream a model pull with progress events. Defaults to the admin endpoint
 * (used by the admin panel); pass "/api/models/pull" for any authenticated
 * user (e.g. the first-run setup wizard).
 */
export async function streamPullModel(
  model: string,
  onStatus: (s: string, progress?: { completed: number; total: number }) => void,
  onDone: () => void,
  onError: (e: string) => void,
  endpoint: "/api/admin/models/pull" | "/api/models/pull" = "/api/admin/models/pull",
): Promise<void> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ model }),
  });
  if (!res.ok || !res.body) { onError(`Pull failed: ${res.status}`); return; }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, sep).split("\n").find((l) => l.startsWith("data:"));
      buf = buf.slice(sep + 2);
      if (!line) continue;
      const p = JSON.parse(line.slice(5).trim());
      if (p.status) onStatus(p.status, typeof p.total === "number" && p.total > 0 ? { completed: p.completed ?? 0, total: p.total } : undefined);
      if (p.done) onDone();
      if (p.error) onError(p.error);
    }
  }
}

/**
 * Send a message and consume the SSE token stream from the local engine.
 * Uses fetch (not EventSource) so we can POST the body + auth header.
 */
export async function streamChat(
  body: { chatId: string; content: string; model?: string; imageBase64?: string; imageMime?: string; attachmentBase64?: string; attachmentMime?: string; attachmentName?: string; replaceFromMessageId?: string },
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    handlers.onError?.(`Chat failed: ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = JSON.parse(line.slice(5).trim());
      if (payload.token) handlers.onToken(payload.token);
      if (payload.title) handlers.onTitle?.(payload.title);
      if (payload.error) handlers.onError?.(payload.error);
      if (payload.done) handlers.onDone?.();
    }
  }
}
