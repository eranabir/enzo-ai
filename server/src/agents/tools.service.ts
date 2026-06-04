import { Injectable, Logger, ForbiddenException } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";
import { CalendarService } from "../calendar/calendar.service";
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

export type ToolName = "get_datetime" | "calculator" | "web_search" | "read_url" | "read_file" | "list_directory" | "git" | "get_calendar_events";

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
      description: "Get upcoming events from the user's Google Calendar.",
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
];

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly calendar: CalendarService,
  ) {}

  /** All tools with live enabled/disabled status. */
  getAllWithStatus(): Array<{ name: ToolName; description: string; enabled: boolean }> {
    const disabled = this.settings.getDisabledTools();
    return ALL_TOOL_DEFINITIONS.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      enabled: !disabled.includes(t.function.name),
    }));
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
      return `• ${e.title} — ${when}${e.location ? ` @ ${e.location}` : ""}`;
    });
    return `Upcoming events (next ${d} days):\n${lines.join("\n")}`;
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
