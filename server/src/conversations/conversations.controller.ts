import {
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
import { ConversationsService } from "./conversations.service";

@Controller("conversations")
@UseGuards(AuthGuard)
export class ConversationsController {
  constructor(private readonly convos: ConversationsService) {}

  @Get()
  list(@UserId() userId: string) {
    return this.convos.list(userId);
  }

  @Post()
  create(@UserId() userId: string, @Body() body: { model?: string }) {
    return this.convos.create(userId, body?.model);
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
    @Body() body: { title?: string; model?: string },
  ) {
    const convo = this.convos.get(id, userId);
    if (!convo) throw new NotFoundException("not found");
    if (typeof body?.title === "string") this.convos.rename(convo.id, body.title);
    if (typeof body?.model === "string")
      this.convos.setModel(convo.id, body.model);
    return this.convos.get(convo.id, userId);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id") id: string) {
    const convo = this.convos.get(id, userId);
    if (convo) this.convos.delete(convo.id);
  }
}
