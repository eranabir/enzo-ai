import type {
  Conversation,
  ConversationDetail,
  ModelInfo,
  ProfileSummary,
  User,
} from "./types";

const TOKEN_KEY = "enzo_token";

let token: string | null = localStorage.getItem(TOKEN_KEY);

export function getToken() {
  return token;
}

export function setToken(value: string | null) {
  token = value;
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

/** Build headers, including the session token when signed in. */
function headers(json = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h["content-type"] = "application/json";
  if (token) h["x-enzo-token"] = token;
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

  createConversation: () =>
    fetch("/api/conversations", { method: "POST", headers: headers() }).then(
      parse<Conversation>,
    ),

  getConversation: (id: string) =>
    fetch(`/api/conversations/${id}`, { headers: headers() }).then(
      parse<ConversationDetail>,
    ),

  deleteConversation: (id: string) =>
    fetch(`/api/conversations/${id}`, { method: "DELETE", headers: headers() }),

  // ---- models (public) ----
  models: () =>
    fetch("/api/models").then(parse<{ models: ModelInfo[]; default: string }>),

  status: () => fetch("/api/models/status").then(parse<{ ollama: boolean }>),

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
  body: { conversationId: string; content: string; model?: string },
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
