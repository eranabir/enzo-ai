import { Injectable, Logger, ForbiddenException } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";
import { CalendarService } from "../calendar/calendar.service";
import { GmailService } from "../gmail/gmail.service";
import { AgentCredentialsService } from "./agent-credentials.service";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Read-only git subcommands — write operations (push, commit, reset, etc.) are intentionally excluded
const SAFE_GIT_SUBCOMMANDS = new Set([
  "status", "log", "diff", "show", "branch", "blame",
  "shortlog", "describe", "tag", "remote", "ls-files",
  "ls-tree", "rev-parse", "rev-list", "config", "stash",
]);

export type ToolName = "get_datetime" | "calculator" | "web_search" | "read_url" | "git" | "calendar" | "search_emails" | "read_email" | "list_directory" | "read_file" | "api_request";

/** Resolve a subpath against the chat's attached project folder, rejecting
 *  anything that would escape it (e.g. "../../etc/passwd"). */
function resolveWithinFolder(root: string, subpath: string): string {
  const target = path.resolve(root, subpath.trim() || ".");
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("That path is outside the attached project folder.");
  }
  return target;
}

/**
 * Tools that need a connected account before they can run. Maps the tool to a
 * connection/provider id (e.g. "google"). Tools not listed here are "system
 * tools" that always work. Connecting the account enables all of its tools.
 */
export const TOOL_CONNECTIONS: Partial<Record<ToolName, string>> = {
  calendar:      "google",
  search_emails: "gmail",
  read_email:    "gmail",
};

export interface ToolDefinition {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const ALL_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_datetime",
      description: "Get the current date and time",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Safely evaluate a mathematical expression and return the result",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Math expression (e.g. '2 + 2 * 3')" },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web and return a summary of results",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_url",
      description: "Fetch and read the text content of a web page or URL",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calendar",
      description:
        "Read, create, or update events on the user's Google Calendar — pick the action you need. " +
        "Use ISO 8601 datetimes (e.g. 2026-06-10T15:00:00) for timed events, or a date-only string " +
        "(e.g. 2026-06-10) for all-day events. Times are interpreted in the user's local timezone.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "create", "update"], description: "\"list\" upcoming events, \"create\" a new one, or \"update\" an existing one" },
          days: { type: "number", description: "list: how many days ahead to look (default 7, max 30)" },
          event_id: { type: "string", description: "update: the id of the event to change (from a previous list action)" },
          summary: { type: "string", description: "create: event title (required). update: new title (optional)" },
          start: { type: "string", description: "create: start time (required). update: new start time (optional)" },
          end: { type: "string", description: "create: end time (required). update: new end time (optional)" },
          description: { type: "string", description: "Optional event description / notes" },
          location: { type: "string", description: "Optional location" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git",
      description: `Run a read-only git command in a repository and return the output. Safe subcommands: ${[...SAFE_GIT_SUBCOMMANDS].join(", ")}. Examples: "log --oneline -20", "diff HEAD~1", "status", "blame src/index.ts", "branch -a".`,
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "Path to the git repository root. Defaults to current working directory if omitted." },
          command: { type: "string", description: "Git subcommand and arguments, e.g. \"log --oneline -10\" or \"diff --stat HEAD~1\"" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_emails",
      description: "Search or list the user's Gmail messages. Returns sender, subject, date, a short snippet, and an id for each. Leave query empty to get the most recent inbox messages. Supports Gmail search syntax (e.g. 'from:boss@x.com', 'is:unread', 'subject:invoice', 'newer_than:7d').",
      parameters: {
        type: "object",
        properties: {
          query:       { type: "string", description: "Gmail search query. Empty = most recent inbox messages." },
          max_results: { type: "number", description: "How many messages to return (default 10, max 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_email",
      description: "Read the full content (sender, recipients, subject, date, body) of a single Gmail message by its id (obtained from search_emails).",
      parameters: {
        type: "object",
        properties: {
          email_id: { type: "string", description: "The id of the message to read (from search_emails)" },
        },
        required: ["email_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "api_request",
      description:
        "Make an HTTP request to any API — GET, POST, custom headers, a body, whatever the target needs. " +
        "If it requires a stored credential (Agent settings → Credentials, e.g. a trading platform's API key), " +
        "write {{credential:NAME}} anywhere in headers, body, or url — it's substituted with that credential's " +
        "real value on the server before the request is sent, so you can place it wherever that particular API " +
        "expects (an Authorization header, a custom header, a query string, or the body) without ever seeing the " +
        "actual secret. No credential is needed for a plain API call.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full URL to call" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], description: "HTTP method (default GET)" },
          headers: { type: "object", description: "Optional request headers, e.g. {\"Authorization\": \"Bearer {{credential:alpaca_trading}}\"}", additionalProperties: { type: "string" } },
          body: { type: "string", description: "Optional request body, as a string, for POST/PUT/PATCH — may also contain {{credential:NAME}}" },
        },
        required: ["url"],
      },
    },
  },
];

/**
 * Tools scoped to a chat's attached project folder (see chats.folder_path).
 * Kept out of ALL_TOOL_DEFINITIONS deliberately: availability is driven by
 * whether a folder is attached to the chat, not by admin/agent tool toggles —
 * the same pattern as knowledge-base retrieval, which isn't a toggleable tool
 * either. chat.service.ts injects these only when convo.folder_path is set.
 */
export const FOLDER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and folders inside the project folder attached to this chat. Omit path (or pass \".\") for the root.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Subpath relative to the project folder root (default: root)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file's contents from the project folder attached to this chat.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to the project folder root" },
        },
        required: ["path"],
      },
    },
  },
];

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly calendar: CalendarService,
    private readonly gmail: GmailService,
    private readonly agentCredentials: AgentCredentialsService,
  ) {}

  /** Tool definitions to inject when a chat has a project folder attached. */
  getFolderToolDefinitions(): ToolDefinition[] {
    return FOLDER_TOOL_DEFINITIONS;
  }

  /** All tools with live enabled/disabled status. */
  getAllWithStatus(userId?: string): Array<{ name: ToolName; description: string; enabled: boolean; requiresConnection?: string; connected: boolean }> {
    const disabled = this.settings.getDisabledTools();
    return ALL_TOOL_DEFINITIONS.map((t) => {
      const requiresConnection = TOOL_CONNECTIONS[t.function.name];
      return {
        name: t.function.name,
        description: t.function.description,
        enabled: !disabled.includes(t.function.name),
        requiresConnection,
        connected: requiresConnection ? this.isConnectionReady(requiresConnection, userId) : true,
      };
    });
  }

  /** Is the account a tool depends on connected for this user (and not disabled by the admin)? */
  isConnectionReady(provider: string, userId?: string): boolean {
    if (!userId) return false;
    if (!this.settings.isConnectionEnabled(provider)) return false; // admin disabled this connection
    if (provider === "google") return this.calendar.getTokenInfo(userId).connected;
    if (provider === "gmail") return this.gmail.getTokenInfo(userId).connected;
    return false;
  }

  /**
   * Tool names offered to a plain chat (no agent attached): every admin-enabled
   * tool, minus any whose required connection isn't ready for this user (so the
   * model isn't handed tools it can't actually use).
   */
  getChatToolNames(userId?: string): ToolName[] {
    // Agent-less chats only get tools when the admin opts in (keeps plain chats
    // fast: no tool-detection round, true streaming). Agents always get theirs.
    if (!this.settings.getChatToolsEnabled()) return [];
    const disabled = this.settings.getDisabledTools();
    return ALL_TOOL_DEFINITIONS
      .map((t) => t.function.name)
      .filter((name) => {
        if (disabled.includes(name)) return false;
        const conn = TOOL_CONNECTIONS[name];
        if (conn && !this.isConnectionReady(conn, userId)) return false;
        return true;
      });
  }

  /** Filter tool definitions to only the enabled ones (for passing to the LLM). */
  getDefinitions(enabledTools: ToolName[]): ToolDefinition[] {
    const disabled = this.settings.getDisabledTools();
    return ALL_TOOL_DEFINITIONS.filter(
      (t) => enabledTools.includes(t.function.name) && !disabled.includes(t.function.name),
    );
  }

  /** Execute a single tool call and return the result string. folderPath is
   *  the chat's attached project folder (see chats.folder_path), if any —
   *  used by list_directory/read_file and as git's default repo. agentId is
   *  the attached agent, if any — used by api_request to look up that
   *  agent's stored credentials. */
  async execute(name: string, args: Record<string, unknown>, userId?: string, folderPath?: string | null, agentId?: string | null): Promise<string> {
    if (!this.settings.isToolEnabled(name)) {
      return `Tool "${name}" is currently disabled by the administrator.`;
    }
    const requiresConnection = TOOL_CONNECTIONS[name as ToolName];
    if (requiresConnection && !this.isConnectionReady(requiresConnection, userId)) {
      return `The "${name}" tool needs the ${requiresConnection} account connected. Ask the user to connect it in Settings → Connections, then try again.`;
    }
    this.logger.debug(`Executing tool: ${name}(${JSON.stringify(args)})`);
    try {
      switch (name as ToolName) {
        case "get_datetime":
          return this.getDatetime();
        case "calculator":
          return this.calculate(String(args.expression ?? ""));
        case "web_search":
          return await this.webSearch(String(args.query ?? ""));
        case "read_url":
          return await this.readUrl(String(args.url ?? ""));
        case "calendar":
          return await this.calendarTool(userId, args);
        case "search_emails":
          return await this.searchEmails(userId, args);
        case "read_email":
          return await this.readEmail(userId, args);
        case "git":
          return await this.runGit(String(args.command ?? ""), args.repo ? String(args.repo) : (folderPath ?? undefined));
        case "list_directory":
          return this.listDirectory(folderPath, String(args.path ?? ""));
        case "read_file":
          return this.readFile(folderPath, String(args.path ?? ""));
        case "api_request":
          return await this.apiRequest(agentId, args);
        default:
          return `Unknown tool: ${name}`;
      }
    } catch (err) {
      return `Tool error: ${(err as Error).message}`;
    }
  }

  private getDatetime(): string {
    return new Date().toLocaleString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZoneName: "short",
    });
  }

  private calculate(expression: string): string {
    // Safe math evaluation — only allow numbers and operators
    const clean = expression.replace(/[^0-9+\-*/().%\s]/g, "");
    if (!clean.trim()) return "Invalid expression";
    try {
      // Use Function constructor instead of eval for slightly better isolation
      // eslint-disable-next-line no-new-func
      const result = new Function(`"use strict"; return (${clean})`)();
      return String(result);
    } catch {
      return "Could not evaluate expression";
    }
  }

  private async webSearch(query: string): Promise<string> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return "Search failed";
    const data = await res.json() as {
      AbstractText?: string;
      AbstractSource?: string;
      RelatedTopics?: { Text?: string; FirstURL?: string }[];
    };

    const lines: string[] = [];
    if (data.AbstractText) {
      lines.push(`Summary (${data.AbstractSource ?? "DuckDuckGo"}): ${data.AbstractText}`);
    }
    const topics = (data.RelatedTopics ?? [])
      .filter((t) => t.Text)
      .slice(0, 5)
      .map((t) => `- ${t.Text}`);
    if (topics.length) lines.push("\nRelated:", ...topics);
    return lines.join("\n") || "No results found";
  }

  private async readUrl(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; Enzo-AI/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return `Failed to fetch URL (${res.status})`;
    const html = await res.text();
    // Strip HTML tags and collapse whitespace
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return text.slice(0, 4000) + (text.length > 4000 ? "…[truncated]" : "");
  }

  /** Dispatches the unified "calendar" tool to the list/create/update action requested. */
  private async calendarTool(userId: string | undefined, args: Record<string, unknown>): Promise<string> {
    switch (String(args.action ?? "").trim()) {
      case "list":   return this.getCalendarEvents(userId, Number(args.days ?? 7));
      case "create": return this.createCalendarEvent(userId, args);
      case "update": return this.updateCalendarEvent(userId, args);
      default:       return "Invalid action — use \"list\", \"create\", or \"update\".";
    }
  }

  private async getCalendarEvents(userId: string | undefined, days: number): Promise<string> {
    if (!userId) return "Calendar not available (no user context).";
    const d = Math.min(Math.max(days, 1), 30);
    const events = await this.calendar.getUpcomingEvents(userId, d);
    if (!events.length) return `No events in the next ${d} days.`;
    const lines = events.map(e => {
      const when = e.allDay
        ? e.start.split("T")[0]
        : new Date(e.start).toLocaleString();
      return `• ${e.title} — ${when}${e.location ? ` @ ${e.location}` : ""} (id: ${e.id})`;
    });
    return `Upcoming events (next ${d} days):\n${lines.join("\n")}`;
  }

  private async createCalendarEvent(userId: string | undefined, args: Record<string, unknown>): Promise<string> {
    if (!userId) return "Calendar not available (no user context).";
    const summary = String(args.summary ?? "").trim();
    const start = String(args.start ?? "").trim();
    const end = String(args.end ?? "").trim();
    if (!summary) return "Cannot create event: a title (summary) is required.";
    if (!start || !end) return "Cannot create event: both start and end are required.";
    const event = await this.calendar.createEvent(userId, {
      summary, start, end,
      description: args.description ? String(args.description) : undefined,
      location:    args.location ? String(args.location) : undefined,
    });
    const when = event.allDay ? event.start.split("T")[0] : new Date(event.start).toLocaleString();
    return `Created event "${event.title}" — ${when}${event.location ? ` @ ${event.location}` : ""} (id: ${event.id})`;
  }

  private async updateCalendarEvent(userId: string | undefined, args: Record<string, unknown>): Promise<string> {
    if (!userId) return "Calendar not available (no user context).";
    const eventId = String(args.event_id ?? "").trim();
    if (!eventId) return "Cannot update event: event_id is required (get it from a \"list\" action first).";
    const patch: { summary?: string; start?: string; end?: string; description?: string; location?: string } = {};
    if (args.summary     !== undefined) patch.summary = String(args.summary);
    if (args.start       !== undefined) patch.start = String(args.start);
    if (args.end         !== undefined) patch.end = String(args.end);
    if (args.description !== undefined) patch.description = String(args.description);
    if (args.location    !== undefined) patch.location = String(args.location);
    if (Object.keys(patch).length === 0) return "Nothing to update: provide at least one field to change.";
    const event = await this.calendar.updateEvent(userId, eventId, patch);
    const when = event.allDay ? event.start.split("T")[0] : new Date(event.start).toLocaleString();
    return `Updated event "${event.title}" — ${when}${event.location ? ` @ ${event.location}` : ""} (id: ${event.id})`;
  }

  private async searchEmails(userId: string | undefined, args: Record<string, unknown>): Promise<string> {
    if (!userId) return "Gmail not available (no user context).";
    const query = args.query ? String(args.query) : "";
    const max = Number(args.max_results ?? 10);
    const emails = await this.gmail.searchEmails(userId, query, max);
    if (!emails.length) return query ? `No emails found for "${query}".` : "No emails found.";
    const lines = emails.map((e) =>
      `• ${e.subject}\n  from: ${e.from} — ${e.date}\n  ${e.snippet}\n  (id: ${e.id})`,
    );
    return `${emails.length} email(s)${query ? ` matching "${query}"` : ""}:\n${lines.join("\n\n")}`;
  }

  private async readEmail(userId: string | undefined, args: Record<string, unknown>): Promise<string> {
    if (!userId) return "Gmail not available (no user context).";
    const id = String(args.email_id ?? "").trim();
    if (!id) return "Cannot read email: email_id is required (get it from search_emails).";
    const e = await this.gmail.getEmail(userId, id);
    const MAX = 6000;
    const body = e.body.length > MAX ? e.body.slice(0, MAX) + "\n…[truncated]" : e.body;
    return `From: ${e.from}\nTo: ${e.to}\nDate: ${e.date}\nSubject: ${e.subject}\n\n${body}`;
  }

  private async runGit(command: string, repo?: string): Promise<string> {
    if (!command.trim()) return "No git command provided";

    // Parse subcommand — first token before any flags
    const [subcommand, ...rest] = command.trim().split(/\s+/);
    if (!SAFE_GIT_SUBCOMMANDS.has(subcommand)) {
      return `Git subcommand "${subcommand}" is not allowed. Permitted: ${[...SAFE_GIT_SUBCOMMANDS].join(", ")}`;
    }

    const cwd = repo ? path.resolve(repo) : process.cwd();

    try {
      const { stdout, stderr } = await execFileAsync("git", [subcommand, ...rest], {
        cwd,
        timeout: 10_000,
        maxBuffer: 1024 * 512, // 512 KB output cap
        env: { ...process.env, GIT_PAGER: "cat" }, // disable interactive pager
      });
      const output = (stdout + (stderr ? `\n[stderr]: ${stderr}` : "")).trim();
      if (!output) return "(no output)";
      const MAX = 8_000;
      return output.length > MAX
        ? output.slice(0, MAX) + `\n…[truncated — ${output.length - MAX} more characters]`
        : output;
    } catch (err: any) {
      // execFile rejects when exit code != 0 — git puts useful info in stderr
      const detail = err.stderr?.trim() || err.message;
      if (detail?.includes("not a git repository")) return `${cwd} is not a git repository`;
      if (err.code === "ENOENT") return "git is not installed or not found in PATH";
      return `git error: ${detail}`;
    }
  }

  private listDirectory(folderPath: string | null | undefined, subpath: string): string {
    if (!folderPath) return "No project folder is attached to this chat.";
    try {
      const target = resolveWithinFolder(folderPath, subpath);
      const entries = fs.readdirSync(target, { withFileTypes: true })
        .filter((e) => e.name !== "node_modules")
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      if (!entries.length) return "(empty directory)";
      return entries.map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`).join("\n");
    } catch (err) {
      return `Could not list directory: ${(err as Error).message}`;
    }
  }

  private readFile(folderPath: string | null | undefined, subpath: string): string {
    if (!folderPath) return "No project folder is attached to this chat.";
    if (!subpath.trim()) return "A file path is required.";
    try {
      const target = resolveWithinFolder(folderPath, subpath);
      const stat = fs.statSync(target);
      if (stat.isDirectory()) return `"${subpath}" is a directory, not a file. Use list_directory instead.`;
      const buffer = fs.readFileSync(target);
      if (buffer.subarray(0, 8000).includes(0)) return `"${subpath}" looks like a binary file — cannot display as text.`;
      const MAX = 30_000;
      const text = buffer.toString("utf8");
      return text.length > MAX
        ? text.slice(0, MAX) + `\n…[truncated — ${text.length - MAX} more characters]`
        : text;
    } catch (err) {
      return `Could not read file: ${(err as Error).message}`;
    }
  }

  /** Makes an HTTP request with {{credential:NAME}} placeholders in the url/
   *  headers/body substituted server-side for that agent-scoped credential's
   *  real value — the model writes and sees only the placeholder, never the
   *  actual secret, but is otherwise free to place it wherever the target API
   *  needs (any header, a query string, or the body). */
  private async apiRequest(agentId: string | null | undefined, args: Record<string, unknown>): Promise<string> {
    if (!agentId) return "This tool requires an agent with a configured credential.";

    const missing = new Set<string>();
    const substitute = (text: string): string =>
      text.replace(/\{\{credential:([^}]+)\}\}/g, (_match, rawName) => {
        const credName = String(rawName).trim();
        const cred = this.agentCredentials.getForTool(agentId, credName);
        if (!cred) { missing.add(credName); return ""; }
        return cred.value;
      });

    const rawUrl = substitute(String(args.url ?? "").trim());
    if (!rawUrl) return "A url is required.";
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return `"${rawUrl}" is not a valid URL.`;
    }

    const headersIn = args.headers && typeof args.headers === "object" ? (args.headers as Record<string, unknown>) : {};
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(headersIn)) headers[key] = substitute(String(value));
    const body = args.body !== undefined ? substitute(String(args.body)) : undefined;

    if (missing.size > 0) {
      return `No credential named "${[...missing].join(", ")}" is configured on this agent (or the vault is locked) — check Agent settings → Credentials.`;
    }

    const method = String(args.method ?? "GET").toUpperCase();
    try {
      const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15_000) });
      const text = await res.text();
      const MAX = 4_000;
      const responseBody = text.length > MAX ? text.slice(0, MAX) + `\n…[truncated — ${text.length - MAX} more characters]` : text;
      return `${res.status} ${res.statusText}\n${responseBody}`;
    } catch (err) {
      return `Request failed: ${(err as Error).message}`;
    }
  }

}
