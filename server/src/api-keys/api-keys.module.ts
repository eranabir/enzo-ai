import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ApiKeysService } from "./api-keys.service";
import { ApiKeysController } from "./api-keys.controller";

@Module({
  imports: [AuthModule],
  providers: [ApiKeysService],
  controllers: [ApiKeysController],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
