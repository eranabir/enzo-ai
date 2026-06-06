import { Injectable, Logger, ForbiddenException } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";
import { CalendarService } from "../calendar/calendar.service";
import { GmailService } from "../gmail/gmail.service";
import { promises as fs } from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Read-only git subcommands — write operations (push, commit, reset, etc.) are intentionally excluded
const SAFE_GIT_SUBCOMMANDS = new Set([
  "status", "log", "diff", "show", "branch", "blame",
  "shortlog", "describe", "tag", "remote", "ls-files",
  "ls-tree", "rev-parse", "rev-list", "config", "stash",
]);

export type ToolName = "get_datetime" | "calculator" | "web_search" | "read_url" | "read_file" | "list_directory" | "git" | "get_calendar_events" | "create_calendar_event" | "update_calendar_event" | "search_emails" | "read_email";

/**
 * Tools that need a connected account before they can run. Maps the tool to a
 * connection/provider id (e.g. "google"). Tools not listed here are "system
 * tools" that always work. Connecting the account enables all of its tools.
 */
export const TOOL_CONNECTIONS: Partial<Record<ToolName, string>> = {
  get_calendar_events:   "google",
  create_calendar_event: "google",
  update_calendar_event: "google",
  search_emails:         "gmail",
  read_email:            "gmail",
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
      name: "read_file",
      description: "Read the text contents of a file on the local machine. Supports code, markdown, JSON, CSV, plain text, and other text-based formats.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative path to the file, e.g. C:/Users/me/notes.txt or /home/me/doc.md" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List the files and folders inside a directory on the local machine.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative path to the directory, e.g. C:/Users/me/Documents" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_calendar_events",
      description: "Get upcoming events from the user's Google Calendar. Each event includes an id you can pass to update_calendar_event.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "How many days ahead to look (default 7, max 30)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_calendar_event",
      description: "Create a new event on the user's primary Google Calendar. Use ISO 8601 datetimes (e.g. 2026-06-10T15:00:00) for timed events, or a date-only string (e.g. 2026-06-10) for all-day events. Times are interpreted in the user's local timezone.",
      parameters: {
        type: "object",
        properties: {
          summary:     { type: "string", description: "Event title" },
          start:       { type: "string", description: "Start time. ISO datetime '2026-06-10T15:00:00' or date '2026-06-10' for all-day." },
          end:         { type: "string", description: "End time. ISO datetime or date. For all-day, the day after the last day." },
          description: { type: "string", description: "Optional event description / notes" },
          location:    { type: "string", description: "Optional location" },
        },
        required: ["summary", "start", "end"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_calendar_event",
      description: "Update an existing Google Calendar event. Provide the event_id (from get_calendar_events) and only the fields you want to change.",
      parameters: {
        type: "object",
        properties: {
          event_id:    { type: "string", description: "The id of the event to update (from get_calendar_events)" },
          summary:     { type: "string", description: "New title" },
          start:       { type: "string", description: "New start time. ISO datetime or date for all-day." },
          end:         { type: "string", description: "New end time. ISO datetime or date for all-day." },
          description: { type: "string", description: "New description" },
          location:    { type: "string", description: "New location" },
        },
        required: ["event_id"],
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
];

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly calendar: CalendarService,
    private readonly gmail: GmailService,
  ) {}

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

  /** Execute a single tool call and return the result string. */
  async execute(name: string, args: Record<string, unknown>, userId?: string): Promise<string> {
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
        case "read_file":
          return await this.readFile(String(args.path ?? ""));
        case "list_directory":
          return await this.listDirectory(String(args.path ?? ""));
        case "get_calendar_events":
          return await this.getCalendarEvents(userId, Number(args.days ?? 7));
        case "create_calendar_event":
          return await this.createCalendarEvent(userId, args);
        case "update_calendar_event":
          return await this.updateCalendarEvent(userId, args);
        case "search_emails":
          return await this.searchEmails(userId, args);
        case "read_email":
          return await this.readEmail(userId, args);
        case "git":
          return await this.runGit(String(args.command ?? ""), args.repo ? String(args.repo) : undefined);
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

  private async readFile(filePath: string): Promise<string> {
    if (!filePath) return "No path provided";
    const resolved = path.resolve(filePath);
    try {
      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) {
        return `${resolved} is a directory — use list_directory to browse it first.`;
      }
      // Guard against very large files overwhelming the context
      const MAX_BYTES = 512_000; // 512 KB
      if (stat.size > MAX_BYTES) {
        return `File is too large (${(stat.size / 1024).toFixed(0)} KB). Maximum supported size is 512 KB.`;
      }
      const content = await fs.readFile(resolved, "utf-8");
      const MAX_CHARS = 16_000;
      const truncated = content.length > MAX_CHARS;
      return (truncated ? content.slice(0, MAX_CHARS) : content)
        + (truncated ? `\n\n…[truncated — ${(content.length - MAX_CHARS).toLocaleString()} more characters not shown]` : "");
    } catch (err: any) {
      if (err.code === "ENOENT") return `File not found: ${resolved}`;
      if (err.code === "EACCES") return `Permission denied: ${resolved}`;
      if (err.code === "EISDIR") return `${resolved} is a directory — use list_directory to browse it.`;
      // Binary file — utf-8 decode fails
      if (err.message?.includes("invalid") || err.code === "ERR_INVALID_ARG_VALUE") {
        return `${resolved} appears to be a binary file and cannot be read as text.`;
      }
      throw err;
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
    if (!eventId) return "Cannot update event: event_id is required (get it from get_calendar_events).";
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

  private async listDirectory(dirPath: string): Promise<string> {
    if (!dirPath) return "No path provided";
    const resolved = path.resolve(dirPath);
    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      if (entries.length === 0) return `Directory is empty: ${resolved}`;

      const MAX_ENTRIES = 100;
      const shown = entries.slice(0, MAX_ENTRIES);

      const lines: string[] = [`Contents of ${resolved}:`, ""];
      await Promise.all(
        shown.map(async (entry) => {
          if (entry.isDirectory()) {
            lines.push(`[DIR]  ${entry.name}/`);
          } else {
            try {
              const s = await fs.stat(path.join(resolved, entry.name));
              const size =
                s.size < 1024 ? `${s.size} B`
                : s.size < 1024 * 1024 ? `${(s.size / 1024).toFixed(1)} KB`
                : `${(s.size / (1024 * 1024)).toFixed(1)} MB`;
              lines.push(`[FILE] ${entry.name} (${size})`);
            } catch {
              lines.push(`[FILE] ${entry.name}`);
            }
          }
        }),
      );

      if (entries.length > MAX_ENTRIES) {
        lines.push(`\n…and ${entries.length - MAX_ENTRIES} more items not shown`);
      }
      return lines.join("\n");
    } catch (err: any) {
      if (err.code === "ENOENT") return `Directory not found: ${resolved}`;
      if (err.code === "EACCES") return `Permission denied: ${resolved}`;
      if (err.code === "ENOTDIR") return `${resolved} is not a directory — use read_file to read it.`;
      throw err;
    }
  }
}
