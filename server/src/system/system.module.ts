import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { LlmModule } from "../llm/llm.module";
import { SystemService } from "./system.service";
import { SystemController } from "./system.controller";

@Module({
  imports: [AuthModule, LlmModule],
  providers: [SystemService],
  controllers: [SystemController],
})
export class SystemModule {}
