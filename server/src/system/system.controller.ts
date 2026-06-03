import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { LlmService } from "../llm/llm.service";
import { SystemService } from "./system.service";

@Controller("system")
@UseGuards(AuthGuard)
export class SystemController {
  constructor(
    private readonly system: SystemService,
    private readonly llm: LlmService,
  ) {}

  /** Full system info + model recommendation in one call. */
  @Get()
  async analyze() {
    const [info, models] = await Promise.all([
      this.system.getSystemInfo(),
      this.llm.ollama.listModels().catch(() => []),
    ]);
    const installedIds = models.map((m) => m.id);
    const recommendation = this.system.recommend(info, installedIds);
    return { info, recommendation };
  }
}
