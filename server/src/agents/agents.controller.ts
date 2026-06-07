import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode,
  NotFoundException, Param, Patch, Post, UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { ToolsService } from "./tools.service";
import { AgentsService, type CreateAgentInput } from "./agents.service";
import { SchedulerService } from "./scheduler.service";

@Controller("agents")
@UseGuards(AuthGuard)
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly scheduler: SchedulerService,
    private readonly tools: ToolsService,
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
}
