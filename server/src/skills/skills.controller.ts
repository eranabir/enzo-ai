import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode,
  NotFoundException, Param, Patch, Post, UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { SkillsService } from "./skills.service";

@Controller("skills")
@UseGuards(AuthGuard)
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  list(@UserId() userId: string) {
    return this.skills.list(userId).map((s) => this.skills.toPublic(s));
  }

  @Post()
  create(@UserId() userId: string, @Body() body: { name?: string; description?: string; instructions?: string }) {
    const name = String(body?.name ?? "").trim();
    const instructions = String(body?.instructions ?? "").trim();
    if (!name) throw new BadRequestException("name is required");
    if (!instructions) throw new BadRequestException("instructions are required");
    return this.skills.toPublic(this.skills.create(userId, { name, description: body?.description, instructions }));
  }

  @Patch(":id")
  update(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body() body: { name?: string; description?: string; instructions?: string },
  ) {
    const updated = this.skills.update(id, userId, body);
    if (!updated) throw new NotFoundException("Skill not found");
    return this.skills.toPublic(updated);
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@UserId() userId: string, @Param("id") id: string) {
    this.skills.delete(id, userId);
  }
}
