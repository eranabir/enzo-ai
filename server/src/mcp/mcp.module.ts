import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { McpService } from "./mcp.service";
import { McpController } from "./mcp.controller";

@Module({
  imports: [AuthModule],
  providers: [McpService],
  controllers: [McpController],
  exports: [McpService],
})
export class McpModule {}
