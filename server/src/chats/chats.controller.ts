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
  Query,
  UseGuards,
} from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AuthGuard } from "../auth/auth.guard";
import { UserId } from "../auth/current-user.decorator";
import { ChatsService } from "./chats.service";

const execFileAsync = promisify(execFile);

/** Current branch name from a repo's .git dir, or null if it can't be read
 *  (e.g. a worktree's .git is a file, or a detached/unborn HEAD format we
 *  don't recognize). Reads .git/HEAD directly rather than shelling out to
 *  git, since this is just a label for the folder picker, not a git op. */
function readGitBranch(gitDir: string): string | null {
  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (m) return m[1];
    return head.slice(0, 7) || null; // detached HEAD — short commit SHA
  } catch {
    return null;
  }
}

/** Insertions/deletions across all uncommitted changes (staged + unstaged),
 *  for the folder picker's repo-status display. Null if git isn't installed
 *  or the diff can't be read (e.g. an unborn HEAD with no commits yet). */
async function readGitDiffStat(repoDir: string): Promise<{ insertions: number; deletions: number } | null> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "HEAD", "--shortstat"], { cwd: repoDir, timeout: 5_000 });
    const insertions = Number(stdout.match(/(\d+) insertion/)?.[1] ?? 0);
    const deletions = Number(stdout.match(/(\d+) deletion/)?.[1] ?? 0);
    return { insertions, deletions };
  } catch {
    return null;
  }
}

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

  /** Check whether a local folder path exists and is a git repository, for the
   *  "attach project folder" picker (must be declared before ":id" below). */
  @Get("check-folder")
  async checkFolder(@Query("path") folderPath: string) {
    const target = (folderPath ?? "").trim();
    const empty = { exists: false, isDirectory: false, isGit: false, branch: null, diffStat: null };
    if (!target) return empty;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      return empty;
    }
    const isDirectory = stat.isDirectory();
    const gitDir = path.join(target, ".git");
    const isGit = isDirectory && fs.existsSync(gitDir);
    return {
      exists: true,
      isDirectory,
      isGit,
      branch: isGit ? readGitBranch(gitDir) : null,
      diffStat: isGit ? await readGitDiffStat(target) : null,
    };
  }

  /** List subfolders of a directory (dotfolders hidden) for the "attach project
   *  folder" browser — lets the user click their way to a folder instead of
   *  typing a full path. Defaults to the home directory when no path is given
   *  or the given path doesn't exist. */
  @Get("browse-folder")
  browseFolder(@Query("path") requested?: string) {
    let target = (requested ?? "").trim() || os.homedir();
    try {
      if (!fs.statSync(target).isDirectory()) target = os.homedir();
    } catch {
      target = os.homedir();
    }
    target = path.resolve(target);

    let folders: string[] = [];
    try {
      folders = fs.readdirSync(target, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      // Permission denied or similar — just show an empty listing.
    }

    const parent = path.dirname(target);
    return { path: target, parent: parent === target ? null : parent, folders };
  }

  @Get(":id")
  getOne(@UserId() userId: string, @Param("id") id: string) {
    const convo = this.convos.get(id, userId);
    if (!convo) throw new NotFoundException("not found");
    return {
      ...convo,
      messages: this.convos.listMessages(convo.id),
      // True while a reply is being generated for this chat by an
      // integration-originated message (Telegram/Discord/Slack) — lets the
      // polling web UI show a live "thinking" indicator for it.
      replying: this.convos.isReplying(convo.id),
    };
  }

  @Patch(":id")
  update(
    @UserId() userId: string,
    @Param("id") id: string,
    @Body() body: { title?: string; model?: string; memoryEnabled?: boolean; folderPath?: string | null },
  ) {
    const convo = this.convos.get(id, userId);
    if (!convo) throw new NotFoundException("not found");
    if (typeof body?.title === "string") this.convos.rename(convo.id, body.title);
    if (typeof body?.model === "string") this.convos.setModel(convo.id, body.model);
    if (typeof body?.memoryEnabled === "boolean")
      this.convos.setMemoryEnabled(convo.id, body.memoryEnabled);
    if (body?.folderPath !== undefined)
      this.convos.setFolderPath(convo.id, body.folderPath?.trim() || null);
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
