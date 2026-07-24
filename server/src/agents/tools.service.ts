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

// ── Safe math expression evaluator ──────────────────────────────────────────
// A hand-written recursive-descent parser — deliberately NOT eval/new Function,
// which would be a remote-code-execution hole once function names (sqrt, …) are
// allowed through. Supports: + - * / , ^ (power, right-assoc), unary minus,
// postfix % (percent = /100, so "340*15%" = 51), parentheses, constants
// (pi, e), and functions: sqrt, cbrt, abs, round, floor, ceil, sign, ln, log
// (base 10), log2, exp, sin, cos, tan, asin, acos, atan, mod(a,b), pow(a,b),
// and variadic min, max, sum, avg/mean, median. Throws on anything else.
const MATH_CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const MATH_FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, round: Math.round,
  floor: Math.floor, ceil: Math.ceil, sign: Math.sign, exp: Math.exp,
  ln: Math.log, log: (x) => Math.log10(x), log2: Math.log2,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  pow: (a, b) => Math.pow(a, b), mod: (a, b) => a % b,
  min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  sum: (...a) => a.reduce((s, x) => s + x, 0),
  avg: (...a) => a.reduce((s, x) => s + x, 0) / a.length,
  mean: (...a) => a.reduce((s, x) => s + x, 0) / a.length,
  median: (...a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
};

function evalMathExpression(input: string): number {
  // Tokenize: numbers, identifiers, operators, parens, comma.
  const tokens = input.match(/\d*\.?\d+(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|[+\-*/^(),%]/g);
  if (!tokens || tokens.join("").replace(/\s/g, "").length !== input.replace(/\s/g, "").length) {
    throw new Error("contains characters that aren't valid math");
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  // expr := term (('+'|'-') term)*
  const parseExpr = (): number => {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") { const op = next(); const r = parseTerm(); v = op === "+" ? v + r : v - r; }
    return v;
  };
  // term := power (('*'|'/') power)*
  const parseTerm = (): number => {
    let v = parsePower();
    while (peek() === "*" || peek() === "/") { const op = next(); const r = parsePower(); v = op === "*" ? v * r : v / r; }
    return v;
  };
  // power := unary ('^' power)?   (right-associative)
  const parsePower = (): number => {
    const b = parseUnary();
    if (peek() === "^") { next(); return Math.pow(b, parsePower()); }
    return b;
  };
  // unary := ('+'|'-') unary | postfix
  const parseUnary = (): number => {
    if (peek() === "+") { next(); return parseUnary(); }
    if (peek() === "-") { next(); return -parseUnary(); }
    return parsePostfix();
  };
  // postfix := primary '%'*
  const parsePostfix = (): number => {
    let v = parsePrimary();
    while (peek() === "%") { next(); v = v / 100; }
    return v;
  };
  const parsePrimary = (): number => {
    const t = peek();
    if (t === undefined) throw new Error("unexpected end of expression");
    if (t === "(") { next(); const v = parseExpr(); if (next() !== ")") throw new Error("missing closing parenthesis"); return v; }
    if (/^[A-Za-z_]/.test(t)) {
      next();
      const key = t.toLowerCase();
      if (peek() === "(") { // function call
        next();
        const args: number[] = [];
        if (peek() !== ")") { args.push(parseExpr()); while (peek() === ",") { next(); args.push(parseExpr()); } }
        if (next() !== ")") throw new Error(`missing ')' after ${t}(`);
        // Object.hasOwn (not `in`/truthiness) so inherited names like
        // "constructor" or "toString" are treated as unknown, never called.
        if (!Object.hasOwn(MATH_FUNCS, key)) throw new Error(`unknown function "${t}"`);
        return MATH_FUNCS[key](...args);
      }
      if (!Object.hasOwn(MATH_CONSTS, key)) throw new Error(`unknown name "${t}"`);
      return MATH_CONSTS[key];
    }
    if (/^\d|^\./.test(t)) { next(); return parseFloat(t); }
    throw new Error(`unexpected "${t}"`);
  };

  const result = parseExpr();
  if (pos !== tokens.length) throw new Error(`unexpected "${peek()}"`);
  return result;
}

// Read-only git subcommands — write operations (push, commit, reset, etc.) are intentionally excluded
const SAFE_GIT_SUBCOMMANDS = new Set([
  "status", "log", "diff", "show", "branch", "blame",
  "shortlog", "describe", "tag", "remote", "ls-files",
  "ls-tree", "rev-parse", "rev-list", "config", "stash",
]);

export type ToolName = "get_datetime" | "date_calc" | "calculator" | "web_search" | "read_url" | "git" | "calendar" | "search_emails" | "read_email" | "list_directory" | "read_file" | "api_request";

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
      name: "date_calc",
      description:
        "Deterministic date arithmetic — ALWAYS use this instead of doing date math yourself, which is error-prone. " +
        "action \"add\": add/subtract a duration to a date (use a negative amount to subtract), e.g. an estimated due date is date=LMP, amount=280, unit=days. " +
        "action \"diff\": whole units between two dates (e.g. current pregnancy week = diff between LMP and today in weeks). " +
        "action \"info\": weekday, ISO week number, day-of-year for a date. " +
        "Dates are ISO YYYY-MM-DD; if you need 'today', call get_datetime first.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["add", "diff", "info"], description: "add | diff | info" },
          date: { type: "string", description: "Base date, ISO YYYY-MM-DD" },
          amount: { type: "number", description: "For add: how many units (negative to subtract)" },
          unit: { type: "string", enum: ["days", "weeks", "months", "years"], description: "For add/diff: the unit" },
          date2: { type: "string", description: "For diff: the second date, ISO YYYY-MM-DD" },
        },
        required: ["action", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculator",
      description:
        "Evaluate a math expression exactly — ALWAYS use this for arithmetic instead of computing in your head. " +
        "Supports + - * / , ^ (power), parentheses, postfix % (percent: 340*15% = 51), constants pi and e, and functions: " +
        "sqrt, cbrt, abs, round, floor, ceil, sign, ln, log (base 10), log2, exp, sin, cos, tan, pow(a,b), mod(a,b), " +
        "and lists min/max/sum/avg/median(1,2,3).",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "Math expression, e.g. 'sqrt(16) + 2^10', 'avg(4, 8, 15)', '340 * 15%'" },
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
        case "date_calc":
          return this.dateCalc(args);
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

  /**
   * Deterministic date arithmetic so the model never does error-prone date
   * math in its head (adding 280 days across month boundaries, leap years,
   * etc.). All computation is in UTC to avoid DST/timezone drift — these are
   * calendar-date operations, not wall-clock ones.
   */
  private dateCalc(args: Record<string, unknown>): string {
    const action = String(args.action ?? "").trim();
    const parse = (v: unknown, label: string): Date => {
      const s = String(v ?? "").trim();
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // accept ISO datetime too, take the date
      if (!m) throw new Error(`${label} must be an ISO date (YYYY-MM-DD), got "${s}"`);
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1) {
        throw new Error(`${label} "${s}" is not a valid calendar date`);
      }
      return d;
    };
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const weekday = (d: Date) => ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getUTCDay()];
    // ISO-8601 week number.
    const isoWeek = (d: Date): number => {
      const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const day = (t.getUTCDay() + 6) % 7; // Mon=0
      t.setUTCDate(t.getUTCDate() - day + 3); // nearest Thursday
      const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
      const firstDay = (firstThu.getUTCDay() + 6) % 7;
      firstThu.setUTCDate(firstThu.getUTCDate() - firstDay + 3);
      return 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86400000));
    };

    try {
      if (action === "add") {
        const base = parse(args.date, "date");
        const amount = Number(args.amount);
        if (!Number.isFinite(amount)) return "add requires a numeric \"amount\".";
        const unit = String(args.unit ?? "days");
        const r = new Date(base.getTime());
        if (unit === "days") r.setUTCDate(r.getUTCDate() + amount);
        else if (unit === "weeks") r.setUTCDate(r.getUTCDate() + amount * 7);
        else if (unit === "months") r.setUTCMonth(r.getUTCMonth() + amount);
        else if (unit === "years") r.setUTCFullYear(r.getUTCFullYear() + amount);
        else return `Unknown unit "${unit}" — use days, weeks, months, or years.`;
        return `${iso(base)} ${amount >= 0 ? "+" : "-"} ${Math.abs(amount)} ${unit} = ${iso(r)} (${weekday(r)})`;
      }
      if (action === "diff") {
        const a = parse(args.date, "date");
        const b = parse(args.date2, "date2");
        const unit = String(args.unit ?? "days");
        const days = Math.round((b.getTime() - a.getTime()) / 86400000);
        if (unit === "days") return `${iso(a)} to ${iso(b)} = ${days} days`;
        if (unit === "weeks") return `${iso(a)} to ${iso(b)} = ${Math.floor(Math.abs(days) / 7) * Math.sign(days)} whole weeks (${days} days)`;
        if (unit === "months" || unit === "years") {
          let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
          if (b.getUTCDate() < a.getUTCDate()) months -= 1; // not a full month yet
          return unit === "months"
            ? `${iso(a)} to ${iso(b)} = ${months} whole months (${days} days)`
            : `${iso(a)} to ${iso(b)} = ${Math.trunc(months / 12)} whole years (${days} days)`;
        }
        return `Unknown unit "${unit}" — use days, weeks, months, or years.`;
      }
      if (action === "info") {
        const d = parse(args.date, "date");
        const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
        const dayOfYear = Math.floor((d.getTime() - startOfYear) / 86400000) + 1;
        return `${iso(d)}: ${weekday(d)}, ISO week ${isoWeek(d)}, day ${dayOfYear} of ${d.getUTCFullYear()}`;
      }
      return 'Invalid action — use "add", "diff", or "info".';
    } catch (err) {
      return `date_calc error: ${(err as Error).message}`;
    }
  }

  private calculate(expression: string): string {
    const expr = String(expression ?? "").trim();
    if (!expr) return "Provide a math expression, e.g. sqrt(16) + 15% of 340 → 340*15%.";
    try {
      const result = evalMathExpression(expr);
      if (!Number.isFinite(result)) return "Result is undefined (e.g. divide by zero or invalid input).";
      // Trim floating-point noise (0.1+0.2) without lying about real precision.
      const rounded = Math.round(result * 1e10) / 1e10;
      return String(rounded);
    } catch (err) {
      return `Could not evaluate "${expr}": ${(err as Error).message}`;
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
