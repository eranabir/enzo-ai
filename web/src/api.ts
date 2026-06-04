import type {
  Conversation,
  ConversationDetail,
  ModelInfo,
  ProfileSummary,
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

  // ---- conversations ----
  listConversations: () =>
    fetch("/api/conversations", { headers: headers() }).then(parse<Conversation[]>),

  createConversation: (agentId?: string) =>
    fetch("/api/conversations", {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify(agentId ? { agentId } : {}),
    }).then(parse<Conversation>),

  getConversation: (id: string) =>
    fetch(`/api/conversations/${id}`, { headers: headers() }).then(
      parse<ConversationDetail>,
    ),

  deleteConversation: (id: string) =>
    fetch(`/api/conversations/${id}`, { method: "DELETE", headers: headers() }),

  // ---- models (auth required — returns local + user's external providers) ----
  models: () =>
    fetch("/api/models", { headers: headers() }).then(parse<{ models: ModelInfo[]; default: string }>),

  status: () => fetch("/api/models/status").then(parse<{ ollama: boolean }>),

  // ── Google Calendar ───────────────────────────────────────────────────────
  calendar: {
    status: () =>
      fetch("/api/calendar/status", { headers: headers() })
        .then(parse<{ configured: boolean; connected: boolean; email?: string; name?: string }>),
    authUrl: () =>
      fetch("/api/calendar/auth/url", { headers: headers() })
        .then(parse<{ url: string }>),
    disconnect: () =>
      fetch("/api/calendar", { method: "DELETE", headers: headers() })
        .then(parse<{ ok: boolean }>),
    adminConfig: () =>
      fetch("/api/admin/calendar/config", { headers: headers() })
        .then(parse<{ clientId: string | null; clientSecret: string | null; configured: boolean }>),
    setAdminConfig: (body: { clientId?: string; clientSecret?: string }) =>
      fetch("/api/admin/calendar/config", {
        method: "PUT", headers: headers(true), body: JSON.stringify(body),
      }).then(parse<{ ok: boolean; configured: boolean }>),
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

  // ---- conversations: toggle memory ----
  setMemory: (conversationId: string, enabled: boolean) =>
    fetch(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: headers(true),
      body: JSON.stringify({ memoryEnabled: enabled }),
    }).then(parse<import("./types").Conversation>),

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

    listTools: () =>
      fetch("/api/admin/tools", { headers: headers() })
        .then(parse<import("./types").ToolDefinition[]>),

    setToolEnabled: (name: string, enabled: boolean) =>
      fetch(`/api/admin/tools/${name}`, {
        method: "PATCH",
        headers: headers(true),
        body: JSON.stringify({ enabled }),
      }).then(parse<import("./types").ToolDefinition[]>),

    getDiscord: () =>
      fetch("/api/admin/discord", { headers: headers() })
        .then(parse<{ enabled: boolean; token: string | null; allowedIds: string; model: string }>),

    saveDiscord: (body: { token?: string; allowedIds?: string; model?: string; reconnect?: boolean }) =>
      fetch("/api/admin/discord", {
        method: "PUT",
        headers: headers(true),
        body: JSON.stringify(body),
      }).then(parse<{ ok: boolean; running: boolean; tag?: string }>),

    stopDiscord: () =>
      fetch("/api/admin/discord", { method: "DELETE", headers: headers() })
        .then(parse<{ ok: boolean; running: boolean }>),

    getSlack: () =>
      fetch("/api/admin/slack", { headers: headers() })
        .then(parse<{ enabled: boolean; botToken: string | null; appToken: string | null; allowedIds: string; model: string }>),

    saveSlack: (body: { botToken?: string; appToken?: string; allowedIds?: string; model?: string; reconnect?: boolean }) =>
      fetch("/api/admin/slack", {
        method: "PUT",
        headers: headers(true),
        body: JSON.stringify(body),
      }).then(parse<{ ok: boolean; running: boolean; botName?: string }>),

    stopSlack: () =>
      fetch("/api/admin/slack", { method: "DELETE", headers: headers() })
        .then(parse<{ ok: boolean; running: boolean }>),

    getTelegram: () =>
      fetch("/api/admin/telegram", { headers: headers() })
        .then(parse<{ enabled: boolean; token: string | null; allowedIds: string; model: string }>),

    saveTelegram: (body: { token?: string; allowedIds?: string; model?: string }) =>
      fetch("/api/admin/telegram", {
        method: "PUT",
        headers: headers(true),
        body: JSON.stringify(body),
      }).then(parse<{ ok: boolean; running: boolean; username?: string }>),

    stopTelegram: () =>
      fetch("/api/admin/telegram", { method: "DELETE", headers: headers() })
        .then(parse<{ ok: boolean; running: boolean }>),
  },
};

export interface ChatHandlers {
  onToken: (token: string) => void;
  onTitle?: (title: string) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
}

/** Stream a model pull with progress events (admin only). */
export async function streamPullModel(
  model: string,
  onStatus: (s: string) => void,
  onDone: () => void,
  onError: (e: string) => void,
): Promise<void> {
  const res = await fetch("/api/admin/models/pull", {
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
      if (p.status) onStatus(p.status);
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
  body: { conversationId: string; content: string; model?: string; imageBase64?: string; imageMime?: string },
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
