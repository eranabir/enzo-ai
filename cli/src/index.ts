#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";
import { api, streamChat } from "./api";
import { clearAuth, loadConfig, saveConfig } from "./config";
import {
  accent, bold, brand, chatInput, dim, divider, ensureAuth,
  error, header, ok, prompt, promptSecret, purple, purple2, spinner,
} from "./ui";

const program = new Command();

program
  .name("enzo-ai")
  .description("Enzo AI — local-first AI assistant CLI")
  .version("0.1.0");

// ── config ────────────────────────────────────────────────────────────────────

const configCmd = program.command("config").description("View and set CLI configuration");

configCmd
  .command("show", { isDefault: true })
  .description("Show current configuration")
  .action(() => {
    const cfg = loadConfig();
    console.log("\n" + brand);
    divider();
    console.log(`  Server URL  ${accent(cfg.serverUrl)}`);
    console.log(`  Username    ${cfg.username ? dim(cfg.username) : dim("not logged in")}`);
    console.log(`  Config file ${dim(require("node:path").join(require("node:os").homedir(), ".enzo-ai", "config.json"))}`);
    console.log();
    console.log(dim("  Tip: enzo-ai config server <url>  to change server"));
    console.log();
  });

configCmd
  .command("server <url>")
  .description("Set the Enzo AI server URL (useful for NAS / Docker deployments)")
  .action((url: string) => {
    try {
      new URL(url); // validate
    } catch {
      console.error(error(`\n  Invalid URL: ${url}\n`));
      console.error(dim("  Example: enzo-ai config server http://192.168.1.100:1616\n"));
      process.exit(1);
    }
    saveConfig({ serverUrl: url });
    console.log(ok(`\n  ✓ Server URL set to ${accent(url)}`));
    console.log(dim("    Run: enzo-ai login  to authenticate with the new server\n"));
  });

// ── status ───────────────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show server health, web UI, models and session")
  .action(async () => {
    const cfg = loadConfig();
    const stop = spinner("Checking…");
    try {
      const [health, modelInfo, statusInfo, profiles] = await Promise.all([
        api.health(),
        api.models(),
        api.status(),
        api.profiles(),
      ]);

      // Detect whether the web UI is served by this server or a separate Vite dev server
      const webUrl = await api.servesFrontend() ? cfg.serverUrl : cfg.serverUrl.replace(/:\d+$/, ":5310");

      // Current session
      let sessionLine = dim("not signed in  ·  run: enzo-ai login");
      if (cfg.token) {
        try {
          const { user } = await api.me();
          sessionLine = `${accent(user.displayName)} ${dim("@" + user.username)} ${user.role === "admin" ? kleur.yellow("(admin)") : ""}`;
        } catch {
          sessionLine = dim("session expired  ·  run: enzo-ai login");
        }
      }

      stop();
      console.log("\n" + brand);
      divider();
      console.log(`  Server  ${ok("●")} ${cfg.serverUrl}`);
      console.log(`  Web UI  ${ok("●")} ${accent(webUrl)}`);
      console.log(`  Ollama  ${statusInfo.ollama ? ok("●") : kleur.red("●")} ${statusInfo.ollama ? ok("running") : kleur.red("offline")}`);
      console.log(`  Model   ${accent(modelInfo.default)}`);
      const list = modelInfo.models.map(m => `${m.id}${m.label ? ` (${m.label})` : ""}`).join(", ");
      console.log(`  Models  ${list || dim("none installed")}`);
      console.log(`  Users   ${profiles.length} registered`);
      console.log(`  You     ${sessionLine}`);
      console.log();
    } catch {
      stop();
      console.error(error(`\nCannot reach server at ${cfg.serverUrl}`));
      console.error(dim("  Is Enzo AI running? Launch the app or run: yarn dev\n"));
      process.exit(1);
    }
  });

// ── login ────────────────────────────────────────────────────────────────────

program
  .command("login")
  .description("Sign in to Enzo AI")
  .option("-u, --username <name>")
  .option("-p, --password <pass>")
  .action(async (opts) => {
    header("sign in");
    const username = opts.username || await prompt("  Username: ");
    const password = opts.password || await promptSecret("  Password: ");
    const stop = spinner("Signing in…");
    try {
      const { token, user } = await api.login(username, password);
      stop();
      saveConfig({ token, username: user.username });
      console.log(ok(`\n  ✓ Signed in as `) + accent(user.displayName) + dim(` (${user.role})`) + "\n");
    } catch (e) {
      stop();
      console.error(error(`\n  ✗ ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── logout ───────────────────────────────────────────────────────────────────

program
  .command("logout")
  .description("Sign out and clear saved token")
  .action(async () => {
    try { await api.logout(); } catch {}
    clearAuth();
    console.log(ok("\n  ✓ Signed out\n"));
  });

// ── whoami ───────────────────────────────────────────────────────────────────

program
  .command("whoami")
  .description("Show current user info")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const { user } = await api.me();
      stop();
      console.log("\n" + brand);
      divider();
      console.log(`  Name       ${accent(user.displayName)}`);
      console.log(`  Username   ${dim("@" + user.username)}`);
      console.log(`  Role       ${user.role === "admin" ? kleur.yellow("admin") : dim("user")}`);
      if (user.superPowers) console.log(`  Powers     ⚡ ${user.superPowers}`);
      if (user.about)       console.log(`  About      ${dim(user.about)}`);
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── chats ──────────────────────────────────────────────────────────────────────

program
  .command("chats")
  .alias("conversations")
  .description("List recent chats with their IDs")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const convos = await api.listConversations();
      stop();
      if (!convos.length) {
        console.log(dim("\n  No chats yet. Start one with: enzo-ai chat\n"));
        return;
      }
      console.log("\n" + brand + "  " + dim(`${convos.length} chats`));
      divider();
      // Header
      console.log(
        `  ${dim("#".padEnd(3))}  ${dim("title".padEnd(40))}  ${dim("id".padEnd(8))}  ${dim("updated")}`,
      );
      console.log(dim(`  ${"─".repeat(70)}`));
      convos.slice(0, 20).forEach((c, i) => {
        const date = new Date(c.updated_at).toLocaleDateString();
        const title = c.title.slice(0, 38).padEnd(40);
        const shortId = accent(c.id.slice(0, 8));
        console.log(`  ${dim(String(i + 1).padStart(2))}   ${title}  ${shortId}  ${dim(date)}`);
      });
      console.log();
      console.log(dim("  Tip: enzo-ai chat -c <id>  to resume a chat"));
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── memories ──────────────────────────────────────────────────────────────────

const memoriesCmd = program.command("memories").description("Manage your memories");

memoriesCmd
  .command("list", { isDefault: true })
  .description("Show all stored memories")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const mems = await api.listMemories();
      stop();
      if (!mems.length) { console.log(dim("\n  No memories yet — they build up as you chat.\n")); return; }
      console.log("\n" + brand + "  " + dim(`${mems.length} memories`));
      divider();
      mems.forEach((m) => {
        const tag = `[${m.type.replace("_"," ")}]`.padEnd(15);
        const colored =
          m.type === "fact"         ? kleur.blue(tag)    :
          m.type === "decision"     ? kleur.yellow(tag)  :
          m.type === "preference"   ? kleur.magenta(tag) :
                                      kleur.green(tag);
        console.log(`  ${colored} ${m.content}`);
      });
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

memoriesCmd
  .command("clear")
  .description("Delete all memories")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const ans = await prompt("  Clear ALL memories? (yes/no): ");
    if (ans !== "yes") { console.log(dim("  Cancelled.\n")); return; }
    const stop = spinner("Clearing…");
    try {
      await api.clearMemories();
      stop();
      console.log(ok("\n  ✓ All memories cleared.\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── agents ────────────────────────────────────────────────────────────────────

const agentsCmd = program.command("agents").description("Manage agents");

agentsCmd
  .command("list", { isDefault: true })
  .description("List all your agents")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const agents = await api.listAgents();
      stop();
      if (!agents.length) {
        console.log(dim("\n  No agents yet. Create one in the web UI.\n"));
        return;
      }
      console.log("\n" + brand + "  " + dim(`${agents.length} agents`));
      divider();
      for (const a of agents) {
        const schedLabel = a.schedule
          ? (a.scheduleEnabled ? kleur.green("● ") : kleur.gray("○ ")) + dim(a.schedule)
          : dim("no schedule");
        const toolsLabel = a.tools.length ? dim(a.tools.join(", ")) : dim("no tools");
        console.log(`  ${accent(a.emoji + " " + a.name.padEnd(22))} ${dim("id:")} ${a.id.slice(0, 8)}  ${schedLabel}`);
        if (a.description) console.log(`  ${" ".repeat(25)}${dim(a.description)}`);
        console.log(`  ${" ".repeat(25)}tools: ${toolsLabel}`);
        if (a.lastRunAt) console.log(`  ${" ".repeat(25)}last run: ${dim(new Date(a.lastRunAt).toLocaleString())}`);
        console.log();
      }
      console.log(dim("  Tip: enzo-ai agents run <id>  to trigger an agent manually"));
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

agentsCmd
  .command("run <id>")
  .description("Manually trigger an agent right now")
  .action(async (id: string) => {
    const { token } = loadConfig();
    ensureAuth(token);

    // Resolve short ID prefix
    const stop = spinner("Resolving agent…");
    let agentId = id;
    try {
      if (id.length < 36) {
        const all = await api.listAgents();
        const match = all.find((a) => a.id.startsWith(id) || a.name.toLowerCase() === id.toLowerCase());
        if (!match) {
          stop();
          console.error(error(`\n  No agent found matching "${id}"\n`));
          console.error(dim("  Run: enzo-ai agents  to see your agents\n"));
          process.exit(1);
        }
        agentId = match.id;
        console.log(dim(`  Running: ${match.emoji} ${match.name} (${match.id.slice(0, 8)}…)`));
      }

      stop();
      const stop2 = spinner("Running agent…");
      await api.runAgent(agentId);
      stop2();
      console.log(ok("\n  ✓ Agent triggered — result saved to memories.\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── tools ─────────────────────────────────────────────────────────────────────

const toolsCmd = program.command("tools").description("List and manage available tools");

toolsCmd
  .command("list", { isDefault: true })
  .description("Show all tools and their status")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const tools = await api.listTools();
      stop();
      console.log("\n" + brand + "  " + dim(`${tools.length} tools`));
      divider();
      for (const t of tools) {
        const status = t.enabled ? ok("● enabled ") : kleur.red("○ disabled");
        console.log(`  ${status}  ${accent(t.name.padEnd(18))} ${dim(t.description)}`);
      }
      console.log();
      console.log(dim("  Admin: enzo-ai tools enable <name>  /  enzo-ai tools disable <name>"));
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

toolsCmd
  .command("enable <name>")
  .description("Enable a tool (admin only)")
  .action(async (name: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner(`Enabling "${name}"…`);
    try {
      await api.setToolEnabled(name, true);
      stop();
      console.log(ok(`\n  ✓ Tool "${name}" enabled.\n`));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

toolsCmd
  .command("disable <name>")
  .description("Disable a tool system-wide (admin only)")
  .action(async (name: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner(`Disabling "${name}"…`);
    try {
      await api.setToolEnabled(name, false);
      stop();
      console.log(ok(`\n  ✓ Tool "${name}" disabled.\n`));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── chat ──────────────────────────────────────────────────────────────────────

program
  .command("chat [message]")
  .description("Chat with Enzo AI  (no arg = interactive session)")
  .option("-m, --model <model>", "Model to use")
  .option("-c, --id <id>", "Resume a specific chat by its ID (from: enzo-ai chats)")
  .action(async (message?: string, opts?: { model?: string; id?: string }) => {
    const { token } = loadConfig();
    ensureAuth(token);

    const stop1 = spinner("Connecting…");
    let convoId: string;
    try {
      if (opts?.id) {
        // Resolve short prefix (e.g. "efed6b76") to full UUID
        const input = opts.id.trim();
        if (input.length < 36) {
          // Prefix match against the user's conversations
          const all = await api.listConversations();
          const match = all.find((c) => c.id.startsWith(input));
          if (!match) {
            stop1();
            console.error(error(`\n  No chat found with ID starting "${input}"\n`));
            console.error(dim("  Run: enzo-ai chats  to see your chats\n"));
            process.exit(1);
            return;
          }
          convoId = match.id;
          console.log(dim(`  Resuming: ${match.title} (${match.id.slice(0, 8)}…)\n`));
        } else {
          convoId = input; // full UUID provided
        }
      } else {
        convoId = (await api.createConversation()).id;
      }
      stop1();
    } catch (e) {
      stop1();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
      return;
    }

    // One-shot
    if (message) {
      await sendAndStream(convoId, message, opts?.model);
      return;
    }

    // Interactive session — use a single persistent readline so stdin
    // stays open between prompts (closing/reopening it causes EOF on the next read).
    header("chat  " + dim("Ctrl+C or /quit to exit"));
    console.log(dim(`  session: ${convoId.slice(0, 8)}…  model: ${opts?.model ?? "default"}\n`));

    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.on("close", () => process.exit(0));

    const askLine = (q: string): Promise<string | null> =>
      new Promise((resolve) => {
        process.stdout.write(q);
        rl.once("line", resolve);
        rl.once("close", () => resolve(null));
      });

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const input = await askLine(bold("You ") + purple("›") + " ");
      if (input === null || input.toLowerCase() === "/quit") {
        console.log(dim("\n  Session ended.\n"));
        rl.close();
        break;
      }
      if (!input.trim()) continue;
      await sendAndStream(convoId, input, opts?.model);
    }
  });

async function sendAndStream(convoId: string, message: string, model?: string) {
  process.stdout.write("\n" + bold(purple2("Enzo AI")) + " " + purple("›") + " ");
  try {
    for await (const event of streamChat(convoId, message, model)) {
      if (event.token) process.stdout.write(event.token);
      if (event.error) { process.stdout.write(error(`\n  Error: ${event.error}`)); break; }
      if (event.done)  break;
    }
    process.stdout.write("\n\n");
  } catch (e) {
    process.stdout.write(error(`\n  ${(e as Error).message}\n\n`));
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

program.addHelpText("beforeAll", "\n" + brand + "  " + dim("local-first AI  ·  v0.1.0") + "\n");
program.parse(process.argv);
if (!process.argv.slice(2).length) program.help();
