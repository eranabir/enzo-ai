import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { MemoriesService } from "./memories.service";
import { MemoryExtractionService } from "./memory-extraction.service";
import { MemoriesController } from "./memories.controller";

@Module({
  imports: [AuthModule, SettingsModule],
  providers: [MemoriesService, MemoryExtractionService],
  controllers: [MemoriesController],
  exports: [MemoriesService, MemoryExtractionService],
})
export class MemoriesModule {}
