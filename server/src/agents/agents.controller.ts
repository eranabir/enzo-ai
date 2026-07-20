import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode,
  NotFoundException, Param, Patch, Post, UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { ToolsService } from "./tools.service";
import { AgentsService, type CreateAgentInput } from "./agents.service";
import { SchedulerService } from "./scheduler.service";
import { AgentCredentialsService } from "./agent-credentials.service";

@Controller("agents")
@UseGuards(AuthGuard)
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly scheduler: SchedulerService,
    private readonly tools: ToolsService,
    private readonly credentials: AgentCredentialsService,
  ) {}

  /** List all tools with their live enabled/disabled + connection status. */
  @Get("tools")
  listTools(@UserId() userId: string) {
    return this.tools.getAllWithStatus(userId);
  }

  /** Manually trigger a scheduled agent right now. */
  @Post(":id/run")
  async runNow(@UserId() userId: string, @Param("id") id: string) {
    const agent = this.agents.get(id, userId);
    if (!agent) throw new NotFoundException("Agent not found");
    if (!agent.schedule_prompt) throw new BadRequestException("Agent has no scheduled prompt to run");
    await this.scheduler.triggerNow(agent.id, agent.user_id, agent.schedule_prompt);
    this.agents.markLastRun(agent.id);
    return { ok: true };
  }

  @Get()
  list(@UserId() userId: string) {
    return this.agents.list(userId).map((a) => this.agents.toPublic(a));
  }

  @Post()
  create(@UserId() userId: string, @Body() body: CreateAgentInput) {
    const agent = this.agents.create(userId, body);
    if (body.schedule && body.scheduleEnabled) this.scheduler.reloadAll();
    return this.agents.toPublic(agent);
  }

  @Get(":id")
  getOne(@UserId() userId: string, @Param("id") id: string) {
    const agent = this.agents.get(id, userId);
    if (!agent) throw new NotFoundException("Agent not found");
    return this.agents.toPublic(agent);
  }

  @Patch(":id")
  update(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body() body: Partial<CreateAgentInput>,
  ) {
    const agent = this.agents.update(id, userId, body);
    if (!agent) throw new NotFoundException("Agent not found");
    this.scheduler.reloadAll();
    return this.agents.toPublic(agent);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id") id: string) {
    this.agents.delete(id, userId);
    this.scheduler.reloadAll();
  }

  // ── Credentials (API keys/tokens scoped to this agent, e.g. a trading
  //    platform key) — values are vault-encrypted and never returned here. ──

  @Get(":id/credentials")
  listCredentials(@UserId() userId: string, @Param("id") id: string) {
    if (!this.agents.get(id, userId)) throw new NotFoundException("Agent not found");
    return this.credentials.list(id, userId);
  }

  @Post(":id/credentials")
  addCredential(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body() body: { name: string; value: string },
  ) {
    if (!this.agents.get(id, userId)) throw new NotFoundException("Agent not found");
    if (!body?.name?.trim() || !body?.value?.trim()) {
      throw new BadRequestException("Both a name and a value are required.");
    }
    return this.credentials.add(id, userId, body.name, body.value);
  }

  @Delete(":id/credentials/:credId")
  @HttpCode(204)
  removeCredential(@UserId() userId: string, @Param("id") id: string, @Param("credId") credId: string) {
    if (!this.agents.get(id, userId)) throw new NotFoundException("Agent not found");
    this.credentials.remove(credId, id, userId);
  }
}
