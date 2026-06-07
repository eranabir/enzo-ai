import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { MemoriesService } from "./memories.service";
import type { MemoryRow } from "../database/database.types";

function serialize(m: MemoryRow) {
  return {
    id: m.id,
    type: m.type,
    content: m.content,
    sourceChatId: m.source_chat_id,
    createdAt: m.created_at,
  };
}

@Controller("memories")
@UseGuards(AuthGuard)
export class MemoriesController {
  constructor(private readonly memories: MemoriesService) {}

  @Get()
  list(@UserId() userId: string) {
    return this.memories.list(userId).map(serialize);
  }

  @Delete()
  @HttpCode(204)
  clearAll(@UserId() userId: string) {
    this.memories.clearAll(userId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id") id: string) {
    this.memories.delete(userId, id);
  }
}
