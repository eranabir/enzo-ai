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

/** Stream SSE from any POST endpoint, yielding each parsed data block. */
export async function* streamSse(
  path: string,
  body: unknown,
): AsyncIterable<Record<string, any>> {
  const url = makeUrl(path);
  const payload = JSON.stringify(body);
  const headers = {
    ...authHeader(),
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(payload)),
  };
  const lib = url.protocol === "https:" ? https : http;
  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = lib.request(url, { method: "POST", headers }, resolve);
    req.on("error", reject);
    req.write(payload);
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
      try { yield JSON.parse(line.slice(5).trim()); } catch { /* skip */ }
    }
  }
}

/** Stream SSE from the chat endpoint, yielding each token. */
export async function* streamChat(
  chatId: string,
  content: string,
  model?: string,
): AsyncIterable<{ token?: string; title?: string; done?: boolean; error?: string }> {
  const url = makeUrl("/api/chat");
  const body = JSON.stringify({ chatId, content, model });
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

  register: (body: { username: string; password: string; firstName?: string; lastName?: string }) =>
    request<{ token: string; user: { username: string; displayName: string; role: string; isAdmin?: boolean } }>(
      "POST", "/api/auth/register", body
    ),

  // ── Vault (encryption) ─────────────────────────────────────────────────────
  vaultStatus: () =>
    request<{ configured: boolean; unlocked: boolean }>("GET", "/api/vault/status"),

  vaultSetup: (passphrase: string) =>
    request<{ ok: boolean; recoveryKey: string; configured: boolean; unlocked: boolean }>(
      "POST", "/api/vault/setup", { passphrase }
    ),

  vaultUnlock: (secret: string) =>
    request<{ ok: boolean; configured: boolean; unlocked: boolean }>(
      "POST", "/api/vault/unlock", { secret }
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

  /** Hardware analysis + model recommendation (mirrors the web setup wizard). */
  system: () => request<{
    info: { cpuCount: number; cpuModel: string; ramGb: number; vramGb: number | null; gpuName: string | null };
    recommendation: {
      modelId: string; label: string; reason: string; alreadyInstalled: boolean;
      alternatives: { modelId: string; label: string; note: string }[];
    };
  }>("GET", "/api/system"),

  listChats: () =>
    request<{ id: string; title: string; model: string | null; updated_at: number }[]>(
      "GET", "/api/chats"
    ),

  createChat: () =>
    request<{ id: string; title: string }>("POST", "/api/chats"),

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

  // ── Connections ────────────────────────────────────────────────────────────
  connectionStatus: () =>
    request<{ telegram: boolean; discord: boolean; slack: boolean }>(
      "GET", "/api/health/integrations"
    ),
};
