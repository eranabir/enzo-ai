import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode,
  NotFoundException, Param, Patch, Post, UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { KnowledgeService } from "./knowledge.service";

@Controller("knowledge")
@UseGuards(AuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  /** Embedding-model availability (for the UI to show a one-time download hint). */
  @Get("status")
  status() {
    return this.knowledge.embedModelStatus();
  }

  @Get("bases")
  listBases(@UserId() userId: string) {
    return this.knowledge.listBases(userId);
  }

  @Post("bases")
  createBase(@UserId() userId: string, @Body() body: { name?: string; description?: string }) {
    const name = String(body?.name ?? "").trim();
    if (!name) throw new BadRequestException("name is required");
    return this.knowledge.createBase(userId, name, body?.description);
  }

  @Delete("bases/:id")
  @HttpCode(204)
  deleteBase(@UserId() userId: string, @Param("id") id: string) {
    this.knowledge.deleteBase(id, userId);
  }

  @Get("bases/:id/documents")
  listDocuments(@UserId() userId: string, @Param("id") id: string) {
    if (!this.knowledge.getBase(id, userId)) throw new NotFoundException("Knowledge base not found");
    return this.knowledge.listDocuments(id, userId);
  }

  @Post("bases/:id/documents")
  async addDocument(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body() body: { title?: string; sourceType?: "text" | "url"; content?: string; url?: string },
  ) {
    const sourceType = body?.sourceType === "url" ? "url" : "text";
    const title = String(body?.title ?? "").trim() || (sourceType === "url" ? String(body?.url ?? "") : "Untitled");
    try {
      return await this.knowledge.addDocument(id, userId, {
        title,
        sourceType,
        content: body?.content,
        url: body?.url,
      });
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Get("documents/:id")
  getDocument(@UserId() userId: string, @Param("id") id: string) {
    try {
      return this.knowledge.getDocumentContent(id, userId);
    } catch (err) {
      throw new NotFoundException((err as Error).message);
    }
  }

  @Patch("documents/:id")
  async updateDocument(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body() body: { title?: string; content?: string },
  ) {
    try {
      return await this.knowledge.updateDocument(id, userId, body);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @Delete("documents/:id")
  @HttpCode(204)
  deleteDocument(@UserId() userId: string, @Param("id") id: string) {
    this.knowledge.deleteDocument(id, userId);
  }
}
