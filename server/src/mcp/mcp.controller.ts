import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { McpService } from "./mcp.service";

@Controller("mcp/servers")
@UseGuards(AuthGuard)
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @Get()
  list(@UserId() userId: string) {
    return this.mcp.list(userId);
  }

  @Post()
  create(
    @UserId() userId: string,
    @Body()
    body: {
      name: string;
      type?: "stdio" | "http";
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
    },
  ) {
    return this.mcp.create(userId, {
      name: body.name,
      type: body.type ?? "stdio",
      command: body.command ?? null,
      args: body.args ?? [],
      env: body.env ?? {},
      url: body.url ?? null,
    });
  }

  @Patch(":id")
  update(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      type?: "stdio" | "http";
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      enabled?: boolean;
    },
  ) {
    const result = this.mcp.update(id, userId, body);
    if (!result) throw new NotFoundException("MCP server not found");
    return result;
  }

  @Delete(":id")
  remove(@UserId() userId: string, @Param("id") id: string) {
    const existing = this.mcp.get(id, userId);
    if (!existing) throw new NotFoundException("MCP server not found");
    this.mcp.delete(id, userId);
    return { ok: true };
  }

  /** Test-connect: try to connect and return discovered tools. */
  @Post(":id/connect")
  async testConnect(@UserId() userId: string, @Param("id") id: string) {
    const server = this.mcp.get(id, userId);
    if (!server) throw new NotFoundException("MCP server not found");
    const tools = await this.mcp.getToolsForUser(userId);
    const mine = tools.filter((t) => t._mcp.serverId === id);
    return { ok: true, toolCount: mine.length, tools: mine.map((t) => t.function.name) };
  }
}
