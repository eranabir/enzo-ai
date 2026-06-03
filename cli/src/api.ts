import * as http from "node:http";
import * as https from "node:https";
import { loadConfig } from "./config";

function getConfig() {
  return loadConfig();
}

function makeUrl(path: string): URL {
  return new URL(path, getConfig().serverUrl);
}

function authHeader(): Record<string, string> {
  const token = getConfig().token;
  return token ? { "x-enzo-ai-token": token } : {};
}

/** Simple JSON request. */
export async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = makeUrl(path);
  const data = body ? JSON.stringify(body) : undefined;
  const headers: Record<string, string> = {
    ...authHeader(),
    ...(data ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(data)) } : {}),
  };

  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, { method, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parsed.message || parsed.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed as T);
          }
        } catch {
          reject(new Error(`Invalid JSON (HTTP ${res.statusCode}): ${raw.slice(0, 100)}`));
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/** Stream SSE from the chat endpoint, yielding each token. */
export async function* streamChat(
  conversationId: string,
  content: string,
  model?: string,
): AsyncIterable<{ token?: string; title?: string; done?: boolean; error?: string }> {
  const url = makeUrl("/api/chat");
  const body = JSON.stringify({ conversationId, content, model });
  const headers = {
    ...authHeader(),
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
  };

  const lib = url.protocol === "https:" ? https : http;

  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = lib.request(url, { method: "POST", headers }, resolve);
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  let buf = "";
  for await (const chunk of response) {
    buf += chunk.toString();
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(5).trim());
      } catch {
        // skip malformed
      }
    }
  }
}

// ── Typed wrappers ───────────────────────────────────────────────────────────

export const api = {
  health: () => request<{ ok: boolean; name: string }>("GET", "/api/health"),

  /** Check if the server is also serving the web UI (production mode). */
  servesFrontend: async (): Promise<boolean> => {
    const url = makeUrl("/");
    return new Promise((resolve) => {
      const lib = url.protocol === "https:" ? require("node:https") : http;
      const req = lib.get(url, (res: http.IncomingMessage) => {
        const ct = res.headers["content-type"] ?? "";
        res.destroy();
        resolve(ct.includes("text/html"));
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1500, () => { req.destroy(); resolve(false); });
    });
  },

  /** Public profile list — no auth needed. */
  profiles: () =>
    request<{ id: string; username: string; displayName: string; role: string }[]>(
      "GET", "/api/auth/profiles"
    ),

  login: (username: string, password: string) =>
    request<{ token: string; user: { username: string; displayName: string; role: string } }>(
      "POST", "/api/auth/login", { username, password }
    ),

  me: () =>
    request<{ user: { username: string; displayName: string; role: string; superPowers: string | null; about: string | null } }>(
      "GET", "/api/auth/me"
    ),

  logout: () => request("POST", "/api/auth/logout"),

  models: () =>
    request<{ models: { id: string; provider: string; label?: string }[]; default: string }>(
      "GET", "/api/models"
    ),

  status: () => request<{ ollama: boolean }>("GET", "/api/models/status"),

  listConversations: () =>
    request<{ id: string; title: string; model: string | null; updated_at: number }[]>(
      "GET", "/api/conversations"
    ),

  createConversation: () =>
    request<{ id: string; title: string }>("POST", "/api/conversations"),

  listMemories: () =>
    request<{ id: string; type: string; content: string; createdAt: number }[]>(
      "GET", "/api/memories"
    ),

  clearMemories: () => request("DELETE", "/api/memories"),

  // ── Agents ───────────────────────────────────────────────────────────────
  listAgents: () =>
    request<{
      id: string; name: string; emoji: string; description: string | null;
      model: string | null; tools: string[]; schedule: string | null;
      scheduleEnabled: boolean; lastRunAt: number | null;
    }[]>("GET", "/api/agents"),

  runAgent: (id: string) =>
    request<{ ok: boolean }>("POST", `/api/agents/${id}/run`),

  // ── Tools ────────────────────────────────────────────────────────────────
  listTools: () =>
    request<{ name: string; description: string; enabled: boolean }[]>(
      "GET", "/api/agents/tools"
    ),

  // Admin: enable / disable a tool
  setToolEnabled: (name: string, enabled: boolean) =>
    request<{ name: string; enabled: boolean }[]>(
      "PATCH", `/api/admin/tools/${name}`, { enabled }
    ),
};
