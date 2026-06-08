import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { ChatsService } from "./chats.service";

@Controller("chats")
@UseGuards(AuthGuard)
export class ChatsController {
  constructor(private readonly convos: ChatsService) {}

  @Get()
  list(@UserId() userId: string) {
    return this.convos.list(userId);
  }

  @Post()
  create(@UserId() userId: string, @Body() body: { model?: string; agentId?: string; knowledgeBaseId?: string }) {
    return this.convos.create(userId, body?.model, body?.agentId, undefined, body?.knowledgeBaseId);
  }

  @Get(":id")
  getOne(@UserId() userId: string, @Param("id") id: string) {
    const convo = this.convos.get(id, userId);
    if (!convo) throw new NotFoundException("not found");
    return { ...convo, messages: this.convos.listMessages(convo.id) };
  }

  @Patch(":id")
  update(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body() body: { title?: string; model?: string; memoryEnabled?: boolean },
  ) {
    const convo = this.convos.get(id, userId);
    if (!convo) throw new NotFoundException("not found");
    if (typeof body?.title === "string") this.convos.rename(convo.id, body.title);
    if (typeof body?.model === "string") this.convos.setModel(convo.id, body.model);
    if (typeof body?.memoryEnabled === "boolean")
      this.convos.setMemoryEnabled(convo.id, body.memoryEnabled);
    return this.convos.get(convo.id, userId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id") id: string) {
    const convo = this.convos.get(id, userId);
    if (!convo) return;
    if (convo.connection) {
      throw new BadRequestException(
        `This chat is managed by the ${convo.connection} connection and cannot be deleted from here.`,
      );
    }
    this.convos.delete(convo.id);
  }
}
