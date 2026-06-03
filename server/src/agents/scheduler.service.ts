import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import * as cron from "node-cron";
import { AgentsService } from "./agents.service";

/**
 * Runs scheduled agents on their cron expressions.
 * The actual chat execution is injected lazily to avoid circular dependencies.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private tasks: Map<string, cron.ScheduledTask> = new Map();

  // Injected after module init to avoid circular dep with ChatService
  private runAgent?: (agentId: string, userId: string, prompt: string) => Promise<void>;

  constructor(private readonly agents: AgentsService) {}

  /** Called by AgentsModule after ChatService is available. */
  setRunner(fn: (agentId: string, userId: string, prompt: string) => Promise<void>) {
    this.runAgent = fn;
  }

  onModuleInit() {
    this.reloadAll();
  }

  onModuleDestroy() {
    this.tasks.forEach((t) => t.stop());
    this.tasks.clear();
  }

  /** Manually trigger an agent immediately (e.g. from the CLI or admin UI). */
  async triggerNow(agentId: string, userId: string, prompt: string): Promise<void> {
    if (!this.runAgent) throw new Error("Agent runner not yet initialized");
    await this.runAgent(agentId, userId, prompt);
  }

  /** Reload all scheduled agents — call after any agent is updated. */
  reloadAll() {
    this.tasks.forEach((t) => t.stop());
    this.tasks.clear();

    const scheduled = this.agents.getAllScheduled();
    for (const agent of scheduled) {
      if (!cron.validate(agent.schedule!)) {
        this.logger.warn(`Agent "${agent.name}" has invalid cron: ${agent.schedule}`);
        continue;
      }
      const task = cron.schedule(agent.schedule!, async () => {
        this.logger.log(`Running scheduled agent: ${agent.name}`);
        try {
          if (this.runAgent && agent.schedule_prompt) {
            await this.runAgent(agent.id, agent.user_id, agent.schedule_prompt);
            this.agents.markLastRun(agent.id);
          }
        } catch (err) {
          this.logger.error(`Scheduled agent "${agent.name}" failed: ${(err as Error).message}`);
        }
      });
      this.tasks.set(agent.id, task);
      this.logger.log(`Scheduled agent "${agent.name}" [${agent.schedule}]`);
    }
  }
}
