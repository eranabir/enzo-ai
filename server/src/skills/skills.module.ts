import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SkillsService } from "./skills.service";
import { SkillsController } from "./skills.controller";

@Module({
  imports: [AuthModule],
  providers: [SkillsService],
  controllers: [SkillsController],
  exports: [SkillsService],
})
export class SkillsModule {}
