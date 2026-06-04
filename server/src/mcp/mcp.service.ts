import { Injectable, Inject, Logger, OnModuleDestroy } from "@nestjs/common";
import { DATABASE, type DatabaseConnection } from "../database/database.module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "crypto";

export interface McpServerConfig {
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

export interface McpToolDefinition {
  type: "function";
  function: {
    name: string;          // namespaced: mcp__{slug}__{originalName}
    description: string;
    parameters: Record<string, unknown>;
  };
  _mcp: {
    serverId: string;
    originalName: string;
  };
}

interface LiveConnection {
  serverId: string;
  slug: string;
  client: Client;
  tools: McpToolDefinition[];
}

@Injectable()
export class McpService implements OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);

  // userId → list of live connections
  private pool = new Map<string, LiveConnection[]>();

  constructor(@Inject(DATABASE) private readonly db: DatabaseConnection) {}

  // ── CRUD ────────────────────────────────────────────────────────────────────

  list(userId: string): McpServerConfig[] {
    const rows = this.db
      .prepare(`SELECT * FROM mcp_servers WHERE user_id = ? ORDER BY created_at ASC`)
      .all(userId) as any[];
    return rows.map(this.deserialize);
  }

  get(id: string, userId: string): McpServerConfig | null {
    const row = this.db
      .prepare(`SELECT * FROM mcp_servers WHERE id = ? AND user_id = ?`)
      .get(id, userId) as any | undefined;
    return row ? this.deserialize(row) : null;
  }

  create(
    userId: string,
    data: Pick<McpServerConfig, "name" | "type" | "command" | "args" | "env" | "url">,
  ): McpServerConfig {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO mcp_servers (id, user_id, name, type, command, args, env, url, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        id, userId, data.name, data.type,
        data.command ?? null,
        JSON.stringify(data.args ?? []),
        JSON.stringify(data.env ?? {}),
        data.url ?? null,
        now,
      );
    return this.get(id, userId)!;
  }

  update(
    id: string,
    userId: string,
    data: Partial<Pick<McpServerConfig, "name" | "type" | "command" | "args" | "env" | "url" | "enabled">>,
  ): McpServerConfig | null {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (data.name !== undefined)    { sets.push("name = ?");    vals.push(data.name); }
    if (data.type !== undefined)    { sets.push("type = ?");    vals.push(data.type); }
    if (data.command !== undefined) { sets.push("command = ?"); vals.push(data.command); }
    if (data.args !== undefined)    { sets.push("args = ?");    vals.push(JSON.stringify(data.args)); }
    if (data.env !== undefined)     { sets.push("env = ?");     vals.push(JSON.stringify(data.env)); }
    if (data.url !== undefined)     { sets.push("url = ?");     vals.push(data.url); }
    if (data.enabled !== undefined) { sets.push("enabled = ?"); vals.push(data.enabled ? 1 : 0); }
    if (!sets.length) return this.get(id, userId);
    vals.push(id, userId);
    this.db.prepare(`UPDATE mcp_servers SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...vals);
    // Drop cached connection so next call reconnects with updated config
    this.dropConnection(userId, id);
    return this.get(id, userId);
  }

  delete(id: string, userId: string): void {
    this.dropConnection(userId, id);
    this.db.prepare(`DELETE FROM mcp_servers WHERE id = ? AND user_id = ?`).run(id, userId);
  }

  // ── Connection pool ──────────────────────────────────────────────────────────

  /**
   * Get (or create) live connections for all enabled servers of a user.
   * Returns merged tool definitions from all servers.
   */
  async getToolsForUser(userId: string): Promise<McpToolDefinition[]> {
    const servers = this.list(userId).filter((s) => s.enabled);
    if (!servers.length) return [];

    const existing = this.pool.get(userId) ?? [];
    const connections: LiveConnection[] = [];

    for (const server of servers) {
      const cached = existing.find((c) => c.serverId === server.id);
      if (cached) {
        connections.push(cached);
        continue;
      }
      try {
        const conn = await this.connect(server);
        connections.push(conn);
      } catch (err) {
        this.logger.warn(`Failed to connect to MCP server "${server.name}": ${(err as Error).message}`);
      }
    }

    this.pool.set(userId, connections);
    return connections.flatMap((c) => c.tools);
  }

  /**
   * Execute an MCP tool call. toolName is the namespaced name (mcp__{slug}__{orig}).
   */
  async callTool(userId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const connections = this.pool.get(userId) ?? [];
    for (const conn of connections) {
      const tool = conn.tools.find((t) => t.function.name === toolName);
      if (!tool) continue;
      try {
        const result = await conn.client.callTool({
          name: tool._mcp.originalName,
          arguments: args,
        });
        // MCP result is { content: Array<{ type, text }> }
        const content = (result as any).content ?? [];
        return content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n") || JSON.stringify(result);
      } catch (err) {
        return `MCP tool error: ${(err as Error).message}`;
      }
    }
    return `MCP tool "${toolName}" not found in active connections.`;
  }

  /** Check if a tool name belongs to MCP (starts with mcp__). */
  isMcpTool(toolName: string): boolean {
    return toolName.startsWith("mcp__");
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  private async connect(server: McpServerConfig): Promise<LiveConnection> {
    this.logger.log(`Connecting to MCP server "${server.name}" (${server.type})`);
    const slug = this.slug(server.name);

    const client = new Client({ name: "enzo-ai", version: "1.0.0" });

    if (server.type === "stdio") {
      if (!server.command) throw new Error("stdio MCP server requires a command");
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: { ...process.env as Record<string, string>, ...server.env },
      });
      await client.connect(transport);
    } else {
      // HTTP/SSE — not yet wired, placeholder
      throw new Error("HTTP MCP transport not yet supported");
    }

    const { tools: rawTools } = await client.listTools();
    const tools: McpToolDefinition[] = rawTools.map((t) => ({
      type: "function",
      function: {
        name: `mcp__${slug}__${t.name}`,
        description: `[${server.name}] ${t.description ?? t.name}`,
        parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      },
      _mcp: {
        serverId: server.id,
        originalName: t.name,
      },
    }));

    this.logger.log(`MCP "${server.name}": discovered ${tools.length} tools`);
    return { serverId: server.id, slug, client, tools };
  }

  private dropConnection(userId: string, serverId: string) {
    const conns = this.pool.get(userId);
    if (!conns) return;
    const idx = conns.findIndex((c) => c.serverId === serverId);
    if (idx === -1) return;
    const [conn] = conns.splice(idx, 1);
    try { conn.client.close(); } catch { /* ignore */ }
    this.pool.set(userId, conns);
  }

  private slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  private deserialize(row: any): McpServerConfig {
    return {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      type: row.type,
      command: row.command,
      args: JSON.parse(row.args ?? "[]"),
      env: JSON.parse(row.env ?? "{}"),
      url: row.url,
      enabled: row.enabled === 1,
      created_at: row.created_at,
    };
  }

  async onModuleDestroy() {
    for (const conns of this.pool.values()) {
      for (const conn of conns) {
        try { conn.client.close(); } catch { /* ignore */ }
      }
    }
    this.pool.clear();
  }
}
