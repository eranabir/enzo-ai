#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";
import { api, streamChat, streamSse } from "./api";
import { clearAuth, loadConfig, saveConfig } from "./config";
import {
  accent, bold, brand, chatInput, dim, divider, ensureAuth,
  error, header, ok, prompt, promptSecret, purple, purple2, spinner, warn,
} from "./ui";

const program = new Command();

program
  .name("enzo-ai")
  .description("Enzo AI — local-first AI assistant CLI")
  .version("3.1.2");

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
      const [health, modelInfo, statusInfo, profiles, connections] = await Promise.all([
        api.health(),
        api.models(),
        api.status(),
        api.profiles(),
        api.connectionStatus().catch(() => ({ telegram: false, discord: false, slack: false })),
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
      // Show connected accounts if any are running
      const connectedConnections = [
        connections.telegram && "Telegram",
        connections.discord  && "Discord",
        connections.slack    && "Slack",
      ].filter(Boolean);
      if (connectedConnections.length) {
        console.log(`  Bots    ${ok("●")} ${connectedConnections.join(", ")}`);
      }
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

// ── register / setup wizard ────────────────────────────────────────────────────

program
  .command("register")
  .alias("setup")
  .description("Create an account and run the full setup wizard (encryption, model)")
  .option("-u, --username <name>")
  .action(async (opts) => {
    header("setup");

    // 1. Server reachable?
    const stopH = spinner("Connecting to Enzo AI…");
    try { await api.health(); stopH(); }
    catch {
      stopH();
      console.error(error(`\n  ✗ Can't reach the server at ${loadConfig().serverUrl}.`));
      console.error(dim(`    Make sure it's running, or set it: enzo-ai config server <url>\n`));
      process.exit(1);
    }

    // 2. First user becomes admin.
    let firstUser = false;
    try { firstUser = (await api.profiles()).length === 0; } catch { /* ignore */ }
    console.log(firstUser
      ? "\n  " + accent("You're the first user — you'll be the admin.")
      : dim("\n  Creating an additional account."));

    // 3. Credentials.
    const username = opts.username || await prompt("\n  Username: ");
    if (!username) { console.error(error("\n  Username is required.\n")); process.exit(1); }
    let password = "";
    for (;;) {
      password = await promptSecret("  Password (min 4 chars): ");
      if (password.length < 4) { console.log(warn("  Too short — at least 4 characters.")); continue; }
      const confirm = await promptSecret("  Confirm password: ");
      if (confirm !== password) { console.log(warn("  Passwords don't match — try again.")); continue; }
      break;
    }
    const firstName = await prompt("  First name (optional): ");
    const lastName  = await prompt("  Last name (optional): ");

    // 4. Create the account + save the session.
    const stopR = spinner("Creating your account…");
    let user: { username: string; displayName: string; role: string; isAdmin?: boolean };
    try {
      const res = await api.register({
        username, password,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
      });
      saveConfig({ token: res.token, username: res.user.username });
      user = res.user;
      stopR();
      console.log(ok("\n  ✓ Account created — ") + accent(user.displayName) + dim(` (${user.role})`));
    } catch (e) {
      stopR();
      console.error(error(`\n  ✗ ${(e as Error).message}\n`));
      process.exit(1);
    }

    const isAdmin = user.role === "admin" || user.isAdmin === true;

    // 5. Encryption (admin only, if not already configured).
    if (isAdmin) {
      let configured = false;
      try { configured = (await api.vaultStatus()).configured; } catch { /* ignore */ }
      if (!configured) {
        divider();
        console.log(bold("\n  🔒 Secure your chats"));
        console.log(dim("  Encrypt your messages, titles and memories at rest with a passphrase."));
        console.log(dim("  A copied database or backup is useless without it.\n"));
        const want = (await prompt("  Set up encryption now? [Y/n]: ")).toLowerCase();
        if (want !== "n" && want !== "no") {
          let pass = "";
          for (;;) {
            pass = await promptSecret("  Choose a passphrase (min 6 chars): ");
            if (pass.length < 6) { console.log(warn("  Too short — at least 6 characters.")); continue; }
            const c = await promptSecret("  Confirm passphrase: ");
            if (c !== pass) { console.log(warn("  Passphrases don't match — try again.")); continue; }
            break;
          }
          const stopE = spinner("Encrypting…");
          try {
            const res = await api.vaultSetup(pass);
            stopE();
            console.log(ok("\n  ✓ Encryption enabled\n"));
            console.log(warn("  ⚠  SAVE YOUR RECOVERY KEY — shown only once:"));
            console.log("\n     " + bold(accent(res.recoveryKey)) + "\n");
            console.log(dim("  This is the only way back in if you forget your passphrase."));
            await prompt("\n  Press Enter once you've saved it… ");
          } catch (e) {
            stopE();
            console.error(error(`\n  ✗ ${(e as Error).message}\n`));
          }
        } else {
          console.log(dim("  Skipped — enable it later from the app's Admin → Encryption.\n"));
        }
      }
    }

    // 6. Local model.
    divider();
    console.log(bold("\n  Model setup"));
    let ollama = false;
    try { ollama = (await api.status()).ollama; } catch { /* ignore */ }
    if (!ollama) {
      console.log(warn("\n  Local engine (Ollama) not detected — skipping model download."));
      console.log(dim("  Install Ollama, or add a cloud API key later.\n"));
    } else {
      try {
        const { models, default: def } = await api.models();
        const installed = new Set(models.map((m) => m.id));
        if (models.length > 0) {
          console.log(ok(`\n  ✓ ${models.length} model(s) ready: `) + dim([...installed].slice(0, 4).join(", ")));
        }

        console.log("\n  How would you like to pick a model?");
        console.log(`    ${accent("[1]")} Use the default${installed.has(def) ? ok(" (installed)") : ""}  ${dim(def)}`);
        console.log(`    ${accent("[2]")} Analyze my system & choose`);
        console.log(`    ${accent("[3]")} Skip`);
        const choice = (await prompt("\n  Choose [1/2/3] (Enter = 1): ")).trim() || "1";

        if (choice === "3") {
          console.log(dim("  Skipped."));
        } else if (choice === "2") {
          const stopA = spinner("Analyzing your system…");
          let a: Awaited<ReturnType<typeof api.system>> | null = null;
          try { a = await api.system(); stopA(); }
          catch (e) { stopA(); console.log(warn(`  Couldn't analyze: ${(e as Error).message}`)); }
          if (a) {
            const i = a.info;
            console.log(dim(`\n  ${i.cpuCount} cores · ${i.ramGb} GB RAM · GPU ${i.gpuName ?? "—"}${i.vramGb ? ` (${i.vramGb} GB VRAM)` : ""}`));
            const opts = [
              { modelId: a.recommendation.modelId, label: a.recommendation.label, note: a.recommendation.reason, rec: true },
              ...a.recommendation.alternatives.map((x) => ({ ...x, rec: false })),
            ];
            console.log("\n  Recommended for your system:");
            opts.forEach((o, idx) => {
              console.log(`    ${accent(`[${idx + 1}]`)} ${bold(o.label)}${o.rec ? purple2(" ★ recommended") : ""}${installed.has(o.modelId) ? ok(" ✓ installed") : ""}`);
              console.log(dim(`        ${o.note} · ${o.modelId}`));
            });
            const n = parseInt((await prompt(`\n  Pick a model [1-${opts.length}] (Enter = 1): `)).trim() || "1", 10);
            const chosen = opts[n >= 1 && n <= opts.length ? n - 1 : 0];
            if (installed.has(chosen.modelId)) console.log(ok(`\n  ✓ ${chosen.modelId} is already installed`));
            else await pullWithProgress(chosen.modelId);
          }
        } else {
          // default
          if (installed.has(def)) console.log(ok(`\n  ✓ ${def} is already installed`));
          else await pullWithProgress(def);
        }
      } catch (e) {
        console.log(warn(`\n  Couldn't load models: ${(e as Error).message}`));
      }
    }

    // 7. Done.
    divider();
    console.log(ok("\n  ✓ All set! ") + dim("Start chatting:") + "  " + accent("enzo-ai chat") + "\n");
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

const chatsCmd = program.command("chats").description("List and manage your chats");

chatsCmd
  .command("list", { isDefault: true })
  .description("List recent chats with their IDs")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const convos = await api.listChats();
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

chatsCmd
  .command("show <id>")
  .description("Print a chat's messages")
  .action(async (id: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const c = await resolveChatId(id);
      const full = await api.getChat(c.id);
      stop();
      console.log("\n" + brand + "  " + accent(full.title));
      divider();
      for (const m of full.messages) {
        const who = m.role === "user" ? bold("You") : m.role === "assistant" ? purple2("Enzo AI") : dim("system");
        console.log(`  ${who} ${dim("›")} ${m.content}\n`);
      }
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

chatsCmd
  .command("rename <id> <title>")
  .description("Rename a chat")
  .action(async (id: string, title: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    try {
      const c = await resolveChatId(id);
      const stop = spinner("Renaming…");
      await api.updateChat(c.id, { title });
      stop();
      console.log(ok(`\n  ✓ Renamed to "${title}"\n`));
    } catch (e) {
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

chatsCmd
  .command("delete <id>")
  .description("Delete a chat")
  .option("-y, --yes", "Skip confirmation")
  .action(async (id: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    try {
      const c = await resolveChatId(id);
      if (!opts.yes) {
        const ans = await prompt(`  Delete "${c.title}"? (yes/no): `);
        if (ans !== "yes") { console.log(dim("  Cancelled.\n")); return; }
      }
      const stop = spinner("Deleting…");
      await api.deleteChat(c.id);
      stop();
      console.log(ok("\n  ✓ Deleted\n"));
    } catch (e) {
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
        console.log(`  ${colored} ${m.content}  ${dim(m.id.slice(0, 8))}`);
      });
      console.log();
      console.log(dim("  Tip: enzo-ai memories remove <id>  to delete one"));
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

memoriesCmd
  .command("remove <id>")
  .description("Delete a single memory")
  .action(async (id: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Removing…");
    try {
      let memId = id;
      if (id.length < 36) {
        const all = await api.listMemories();
        const match = all.find((m) => m.id.startsWith(id));
        if (!match) {
          stop();
          console.error(error(`\n  No memory found matching "${id}"\n`));
          process.exit(1);
        }
        memId = match!.id;
      }
      await api.removeMemory(memId);
      stop();
      console.log(ok("\n  ✓ Removed\n"));
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

agentsCmd
  .command("show <id>")
  .description("Show full details for one agent")
  .action(async (id: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const a = await resolveAgentId(id);
      stop();
      console.log("\n" + brand + "  " + accent(a.emoji + " " + a.name));
      divider();
      console.log(`  ${dim("id")}          ${a.id}`);
      if (a.description) console.log(`  ${dim("description")} ${a.description}`);
      console.log(`  ${dim("model")}       ${a.model ?? dim("(default)")}`);
      console.log(`  ${dim("tools")}       ${a.tools.length ? a.tools.join(", ") : dim("none")}`);
      console.log(`  ${dim("knowledge")}   ${a.knowledgeBaseId ?? dim("none")}`);
      console.log(`  ${dim("schedule")}    ${a.schedule ? `${a.schedule} ${a.scheduleEnabled ? ok("(enabled)") : dim("(disabled)")}` : dim("none")}`);
      if (a.telegramChatIds) console.log(`  ${dim("integrations")} ${a.telegramChatIds}`);
      console.log(`  ${dim("instructions")}`);
      console.log(dim("  " + "─".repeat(50)));
      console.log("  " + a.instructions.split("\n").join("\n  "));
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

function collectTools(value: string, prev: string[]): string[] {
  return [...prev, ...value.split(",").map((s) => s.trim()).filter(Boolean)];
}

agentsCmd
  .command("create")
  .description("Create a new agent")
  .requiredOption("-n, --name <name>", "Agent name")
  .requiredOption("-i, --instructions <text>", "System instructions for the agent")
  .option("-e, --emoji <emoji>", "Emoji shown next to the agent's name")
  .option("-d, --description <text>", "Short description")
  .option("-m, --model <model>", "Model to use (defaults to the server default)")
  .option("-t, --tools <name>", "Tool to enable — repeatable", collectTools, [])
  .option("--schedule <cron>", "Cron expression for scheduled runs, e.g. \"0 9 * * *\"")
  .option("--schedule-prompt <text>", "Prompt to run on schedule")
  .option("--schedule-enabled", "Enable the schedule immediately")
  .option("--knowledge-base <id>", "Knowledge base ID to ground answers with")
  .action(async (opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Creating agent…");
    try {
      const agent = await api.createAgent({
        name: opts.name,
        instructions: opts.instructions,
        emoji: opts.emoji,
        description: opts.description,
        model: opts.model,
        tools: opts.tools.length ? opts.tools : undefined,
        schedule: opts.schedule,
        schedulePrompt: opts.schedulePrompt,
        scheduleEnabled: !!opts.scheduleEnabled,
        knowledgeBaseId: opts.knowledgeBase,
      });
      stop();
      console.log(ok(`\n  ✓ Created ${agent.emoji} ${accent(agent.name)}  `) + dim(`(${agent.id.slice(0, 8)}…)`) + "\n");
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

agentsCmd
  .command("update <id>")
  .description("Update an existing agent — only given fields change")
  .option("-n, --name <name>")
  .option("-i, --instructions <text>")
  .option("-e, --emoji <emoji>")
  .option("-d, --description <text>")
  .option("-m, --model <model>")
  .option("-t, --tools <name>", "Replace the tool list — repeatable", collectTools, [])
  .option("--schedule <cron>")
  .option("--schedule-prompt <text>")
  .option("--schedule-enabled <bool>", "true/false")
  .option("--knowledge-base <id>")
  .action(async (id: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Updating…");
    try {
      const a = await resolveAgentId(id);
      const patch: Record<string, unknown> = {};
      if (opts.name !== undefined) patch.name = opts.name;
      if (opts.instructions !== undefined) patch.instructions = opts.instructions;
      if (opts.emoji !== undefined) patch.emoji = opts.emoji;
      if (opts.description !== undefined) patch.description = opts.description;
      if (opts.model !== undefined) patch.model = opts.model;
      if (opts.tools.length) patch.tools = opts.tools;
      if (opts.schedule !== undefined) patch.schedule = opts.schedule;
      if (opts.schedulePrompt !== undefined) patch.schedulePrompt = opts.schedulePrompt;
      if (opts.scheduleEnabled !== undefined) patch.scheduleEnabled = opts.scheduleEnabled === "true";
      if (opts.knowledgeBase !== undefined) patch.knowledgeBaseId = opts.knowledgeBase;
      const updated = await api.updateAgent(a.id, patch);
      stop();
      console.log(ok(`\n  ✓ Updated ${updated.emoji} ${accent(updated.name)}\n`));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

agentsCmd
  .command("delete <id>")
  .description("Delete an agent")
  .option("-y, --yes", "Skip confirmation")
  .action(async (id: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    try {
      const a = await resolveAgentId(id);
      if (!opts.yes) {
        const ans = await prompt(`  Delete "${a.name}"? (yes/no): `);
        if (ans !== "yes") { console.log(dim("  Cancelled.\n")); return; }
      }
      const stop = spinner("Deleting…");
      await api.deleteAgent(a.id);
      stop();
      console.log(ok(`\n  ✓ Deleted ${a.name}\n`));
    } catch (e) {
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── agent credentials ────────────────────────────────────────────────────────

const agentCredsCmd = agentsCmd.command("credentials").description("Manage an agent's API credentials");

agentCredsCmd
  .command("list <agentId>")
  .description("List credentials saved on an agent (names only, values are never shown)")
  .action(async (agentId: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const a = await resolveAgentId(agentId);
      const creds = await api.listAgentCredentials(a.id);
      stop();
      if (!creds.length) { console.log(dim(`\n  No credentials on ${a.name}.\n`)); return; }
      console.log("\n" + brand + "  " + dim(`${creds.length} credentials on ${a.name}`));
      divider();
      for (const c of creds) {
        console.log(`  ${accent(c.name.padEnd(24))} ${dim(c.id.slice(0, 8))}  ${dim(new Date(c.createdAt).toLocaleDateString())}`);
      }
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

agentCredsCmd
  .command("add <agentId>")
  .description("Add a name/value credential to an agent (vault must be set up)")
  .option("--name <name>")
  .option("--value <value>")
  .action(async (agentId: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    try {
      const a = await resolveAgentId(agentId);
      const name = opts.name || await prompt("  Credential name: ");
      const value = opts.value || await promptSecret("  Credential value: ");
      const stop = spinner("Encrypting…");
      const cred = await api.addAgentCredential(a.id, name, value);
      stop();
      console.log(ok(`\n  ✓ Added "${cred.name}" to ${a.name}\n`));
    } catch (e) {
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

agentCredsCmd
  .command("remove <agentId> <credId>")
  .description("Remove a credential from an agent")
  .action(async (agentId: string, credId: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    try {
      const a = await resolveAgentId(agentId);
      const stop = spinner("Removing…");
      await api.removeAgentCredential(a.id, credId);
      stop();
      console.log(ok("\n  ✓ Removed\n"));
    } catch (e) {
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

// ── connections ─────────────────────────────────────────────────────────────────

const connectionsCmd = program.command("connections").alias("integrations")
  .description("View and configure your connections (Telegram, Discord, Slack)");

connectionsCmd
  .command("status", { isDefault: true })
  .description("Show your connections (Telegram, Discord, Slack)")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const status = await api.connectionStatus();
      stop();
      console.log("\n" + brand + "  " + dim("connections"));
      divider();
      const rows = [
        { name: "Telegram", key: "telegram" as const },
        { name: "Discord",  key: "discord"  as const },
        { name: "Slack",    key: "slack"    as const },
      ];
      for (const { name, key } of rows) {
        const running = status[key];
        const dot = running ? ok("●") : dim("○");
        const label = running ? ok("Connected") : dim("Not connected");
        console.log(`  ${dot}  ${name.padEnd(12)} ${label}`);
      }
      console.log();
      console.log(dim("  Tip: enzo-ai connections telegram set --token <token>  to connect"));
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

function printIntegrationStatus(name: string, s: { available: boolean; enabled: boolean; token: string | null; allowedIds: string }) {
  console.log("\n" + brand + "  " + dim(name));
  divider();
  console.log(`  ${dim("available")}   ${s.available ? ok("yes") : dim("disabled by admin")}`);
  console.log(`  ${dim("running")}     ${s.enabled ? ok("● connected") : dim("○ not connected")}`);
  console.log(`  ${dim("token")}       ${s.token ? dim(s.token) : dim("(none)")}`);
  console.log(`  ${dim("allowed ids")} ${s.allowedIds || dim("(any)")}`);
  console.log();
}

// Telegram
const telegramCmd = connectionsCmd.command("telegram").description("Manage your Telegram bot connection");

telegramCmd
  .command("status", { isDefault: true })
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const s = await api.telegramStatus();
      stop();
      printIntegrationStatus("Telegram", s);
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

telegramCmd
  .command("set")
  .description("Connect (or update) your Telegram bot")
  .option("--token <token>", "Bot token from @BotFather")
  .option("--allowed-ids <ids>", "Comma-separated chat IDs allowed to use the bot")
  .action(async (opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const botToken = opts.token || await promptSecret("  Bot token (from @BotFather): ");
    const stop = spinner("Connecting…");
    try {
      const res = await api.telegramSave({ token: botToken, allowedIds: opts.allowedIds });
      stop();
      console.log(ok(`\n  ✓ Connected${res.username ? " as @" + res.username : ""}\n`));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

telegramCmd
  .command("disconnect")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Disconnecting…");
    try {
      await api.telegramDisconnect();
      stop();
      console.log(ok("\n  ✓ Disconnected\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// Discord
const discordCmd = connectionsCmd.command("discord").description("Manage your Discord bot connection");

discordCmd
  .command("status", { isDefault: true })
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const s = await api.discordStatus();
      stop();
      printIntegrationStatus("Discord", s);
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

discordCmd
  .command("set")
  .description("Connect (or update) your Discord bot")
  .option("--token <token>", "Bot token from the Discord developer portal")
  .option("--allowed-ids <ids>", "Comma-separated channel IDs allowed to use the bot")
  .action(async (opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const botToken = opts.token || await promptSecret("  Bot token: ");
    const stop = spinner("Connecting…");
    try {
      const res = await api.discordSave({ token: botToken, allowedIds: opts.allowedIds });
      stop();
      console.log(ok(`\n  ✓ Connected${res.tag ? " as " + res.tag : ""}\n`));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

discordCmd
  .command("disconnect")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Disconnecting…");
    try {
      await api.discordDisconnect();
      stop();
      console.log(ok("\n  ✓ Disconnected\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// Slack
const slackCmd = connectionsCmd.command("slack").description("Manage your Slack app connection");

slackCmd
  .command("status", { isDefault: true })
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const s = await api.slackStatus();
      stop();
      printIntegrationStatus("Slack", s);
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

slackCmd
  .command("set")
  .description("Connect (or update) your Slack app")
  .option("--bot-token <token>", "Bot token (xoxb-…)")
  .option("--app-token <token>", "App-level token (xapp-…)")
  .option("--allowed-ids <ids>", "Comma-separated channel IDs allowed to use the bot")
  .action(async (opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const botToken = opts.botToken || await promptSecret("  Bot token (xoxb-…): ");
    const appToken = opts.appToken || await promptSecret("  App-level token (xapp-…): ");
    const stop = spinner("Connecting…");
    try {
      const res = await api.slackSave({ botToken, appToken, allowedIds: opts.allowedIds });
      stop();
      console.log(ok(`\n  ✓ Connected${res.botName ? " as " + res.botName : ""}\n`));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

slackCmd
  .command("disconnect")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Disconnecting…");
    try {
      await api.slackDisconnect();
      stop();
      console.log(ok("\n  ✓ Disconnected\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── knowledge bases ──────────────────────────────────────────────────────────

const knowledgeCmd = program.command("knowledge").alias("kb").description("Manage knowledge bases and documents");

knowledgeCmd
  .command("bases", { isDefault: true })
  .description("List your knowledge bases")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const bases = await api.listKnowledgeBases();
      stop();
      if (!bases.length) { console.log(dim("\n  No knowledge bases yet. Run: enzo-ai knowledge create <name>\n")); return; }
      console.log("\n" + brand + "  " + dim(`${bases.length} knowledge bases`));
      divider();
      for (const b of bases) {
        console.log(`  ${accent(b.name.padEnd(24))} ${dim(b.id.slice(0, 8))}  ${dim(`${b.document_count} documents`)}`);
        if (b.description) console.log(`  ${" ".repeat(26)}${dim(b.description)}`);
      }
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

knowledgeCmd
  .command("create <name>")
  .description("Create a new knowledge base")
  .option("-d, --description <text>")
  .action(async (name: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Creating…");
    try {
      const base = await api.createKnowledgeBase(name, opts.description);
      stop();
      console.log(ok(`\n  ✓ Created "${base.name}"  `) + dim(`(${base.id.slice(0, 8)}…)`) + "\n");
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

async function resolveKnowledgeBaseId(idOrPrefix: string): Promise<string> {
  if (idOrPrefix.length >= 36) return idOrPrefix;
  const all = await api.listKnowledgeBases();
  const match = all.find((b) => b.id.startsWith(idOrPrefix) || b.name.toLowerCase() === idOrPrefix.toLowerCase());
  if (!match) throw new Error(`No knowledge base found matching "${idOrPrefix}"`);
  return match.id;
}

knowledgeCmd
  .command("delete <id>")
  .description("Delete a knowledge base and all its documents")
  .option("-y, --yes", "Skip confirmation")
  .action(async (id: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    try {
      const kbId = await resolveKnowledgeBaseId(id);
      if (!opts.yes) {
        const ans = await prompt("  Delete this knowledge base and all its documents? (yes/no): ");
        if (ans !== "yes") { console.log(dim("  Cancelled.\n")); return; }
      }
      const stop = spinner("Deleting…");
      await api.deleteKnowledgeBase(kbId);
      stop();
      console.log(ok("\n  ✓ Deleted\n"));
    } catch (e) {
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

knowledgeCmd
  .command("docs <baseId>")
  .description("List documents in a knowledge base")
  .action(async (baseId: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const kbId = await resolveKnowledgeBaseId(baseId);
      const docs = await api.listKnowledgeDocuments(kbId);
      stop();
      if (!docs.length) { console.log(dim("\n  No documents yet.\n")); return; }
      console.log("\n" + brand + "  " + dim(`${docs.length} documents`));
      divider();
      for (const d of docs) {
        const statusLabel = d.status === "ready" ? ok(d.status) : d.status === "error" ? error(d.status) : dim(d.status);
        console.log(`  ${accent(d.title.padEnd(30))} ${dim(d.source_type.padEnd(6))} ${statusLabel}  ${dim(d.id.slice(0, 8))}`);
      }
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

knowledgeCmd
  .command("add <baseId>")
  .description("Add a document to a knowledge base (text, URL, or local file)")
  .option("--title <title>")
  .option("--text <text>", "Inline text content")
  .option("--url <url>", "Fetch and index a URL")
  .option("--file <path>", "Path to a local PDF/Word/Excel/text file")
  .action(async (baseId: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    if (!opts.text && !opts.url && !opts.file) {
      console.error(error("\n  Provide one of --text, --url, or --file\n"));
      process.exit(1);
    }
    const stop = spinner("Adding…");
    try {
      const kbId = await resolveKnowledgeBaseId(baseId);
      let body: Parameters<typeof api.addKnowledgeDocument>[1];
      if (opts.file) {
        const { readFileSync } = await import("node:fs");
        const { basename } = await import("node:path");
        const buf = readFileSync(opts.file);
        body = { title: opts.title, sourceType: "file", filename: basename(opts.file), base64: buf.toString("base64") };
      } else if (opts.url) {
        body = { title: opts.title, sourceType: "url", url: opts.url };
      } else {
        body = { title: opts.title, sourceType: "text", content: opts.text };
      }
      const doc = await api.addKnowledgeDocument(kbId, body);
      stop();
      console.log(ok(`\n  ✓ Added "${doc.title}"  `) + dim(`(${doc.status})`) + "\n");
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

knowledgeCmd
  .command("remove-doc <docId>")
  .description("Delete a document")
  .action(async (docId: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Deleting…");
    try {
      await api.deleteKnowledgeDocument(docId);
      stop();
      console.log(ok("\n  ✓ Deleted\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── MCP servers ──────────────────────────────────────────────────────────────

const mcpCmd = program.command("mcp").description("Manage MCP servers");

mcpCmd
  .command("list", { isDefault: true })
  .description("List your MCP servers")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const servers = await api.listMcpServers();
      stop();
      if (!servers.length) { console.log(dim("\n  No MCP servers yet. Run: enzo-ai mcp add <name>\n")); return; }
      console.log("\n" + brand + "  " + dim(`${servers.length} MCP servers`));
      divider();
      for (const s of servers) {
        const dot = s.enabled ? ok("●") : dim("○");
        const target = s.type === "http" ? s.url : `${s.command} ${s.args.join(" ")}`;
        console.log(`  ${dot}  ${accent(s.name.padEnd(20))} ${dim(`[${s.type}]`)} ${dim(target ?? "")}  ${dim(s.id.slice(0, 8))}`);
      }
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

mcpCmd
  .command("add <name>")
  .description("Add an MCP server")
  .option("--type <type>", "stdio or http", "stdio")
  .option("--command <cmd>", "Command to launch (stdio servers)")
  .option("--args <args>", "Comma-separated command arguments")
  .option("--url <url>", "Server URL (http servers)")
  .option("--env <pair>", "KEY=VALUE env var — repeatable", (v: string, prev: string[]) => [...prev, v], [] as string[])
  .action(async (name: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const env: Record<string, string> = {};
    for (const pair of opts.env as string[]) {
      const idx = pair.indexOf("=");
      if (idx > 0) env[pair.slice(0, idx)] = pair.slice(idx + 1);
    }
    const stop = spinner("Adding…");
    try {
      const server = await api.createMcpServer({
        name,
        type: opts.type === "http" ? "http" : "stdio",
        command: opts.command,
        args: opts.args ? String(opts.args).split(",").map((s: string) => s.trim()).filter(Boolean) : [],
        env,
        url: opts.url,
      });
      stop();
      console.log(ok(`\n  ✓ Added "${server.name}"  `) + dim(`(${server.id.slice(0, 8)}…)`) + "\n");
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

async function resolveMcpServerId(idOrPrefix: string): Promise<string> {
  if (idOrPrefix.length >= 36) return idOrPrefix;
  const all = await api.listMcpServers();
  const match = all.find((s) => s.id.startsWith(idOrPrefix) || s.name.toLowerCase() === idOrPrefix.toLowerCase());
  if (!match) throw new Error(`No MCP server found matching "${idOrPrefix}"`);
  return match.id;
}

mcpCmd
  .command("enable <id>")
  .description("Enable an MCP server")
  .action(async (id: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    try {
      const serverId = await resolveMcpServerId(id);
      await api.updateMcpServer(serverId, { enabled: true });
      console.log(ok("\n  ✓ Enabled\n"));
    } catch (e) {
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

mcpCmd
  .command("disable <id>")
  .description("Disable an MCP server")
  .action(async (id: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    try {
      const serverId = await resolveMcpServerId(id);
      await api.updateMcpServer(serverId, { enabled: false });
      console.log(ok("\n  ✓ Disabled\n"));
    } catch (e) {
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

mcpCmd
  .command("remove <id>")
  .description("Remove an MCP server")
  .option("-y, --yes", "Skip confirmation")
  .action(async (id: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    try {
      const serverId = await resolveMcpServerId(id);
      if (!opts.yes) {
        const ans = await prompt("  Remove this MCP server? (yes/no): ");
        if (ans !== "yes") { console.log(dim("  Cancelled.\n")); return; }
      }
      await api.deleteMcpServer(serverId);
      console.log(ok("\n  ✓ Removed\n"));
    } catch (e) {
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

mcpCmd
  .command("test <id>")
  .description("Connect to an MCP server and list its discovered tools")
  .action(async (id: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Connecting…");
    try {
      const serverId = await resolveMcpServerId(id);
      const res = await api.testMcpServer(serverId);
      stop();
      console.log(ok(`\n  ✓ Connected — ${res.toolCount} tool(s)\n`));
      if (res.tools.length) console.log("  " + res.tools.join(", ") + "\n");
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── vault (encryption) ────────────────────────────────────────────────────────

const vaultCmd = program.command("vault").description("Manage database encryption");

vaultCmd
  .command("status", { isDefault: true })
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const s = await api.vaultStatus();
      stop();
      console.log("\n" + brand + "  " + dim("vault"));
      divider();
      console.log(`  ${dim("configured")} ${s.configured ? ok("yes") : dim("no")}`);
      console.log(`  ${dim("unlocked")}   ${s.unlocked ? ok("yes") : kleur.red("no")}`);
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

vaultCmd
  .command("setup")
  .description("Set up encryption for the first time (admin only)")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    let pass = "";
    for (;;) {
      pass = await promptSecret("  Choose a passphrase (min 6 chars): ");
      if (pass.length < 6) { console.log(warn("  Too short — at least 6 characters.")); continue; }
      const c = await promptSecret("  Confirm passphrase: ");
      if (c !== pass) { console.log(warn("  Passphrases don't match — try again.")); continue; }
      break;
    }
    const stop = spinner("Encrypting…");
    try {
      const res = await api.vaultSetup(pass);
      stop();
      console.log(ok("\n  ✓ Encryption enabled\n"));
      console.log(warn("  ⚠  SAVE YOUR RECOVERY KEY — shown only once:"));
      console.log("\n     " + bold(accent(res.recoveryKey)) + "\n");
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

vaultCmd
  .command("unlock")
  .description("Unlock the vault with your passphrase or recovery key (admin only)")
  .option("-s, --secret <secret>")
  .action(async (opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const secret = opts.secret || await promptSecret("  Passphrase or recovery key: ");
    const stop = spinner("Unlocking…");
    try {
      await api.vaultUnlock(secret);
      stop();
      console.log(ok("\n  ✓ Unlocked\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

vaultCmd
  .command("lock")
  .description("Lock the vault (admin only)")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Locking…");
    try {
      await api.vaultLock();
      stop();
      console.log(ok("\n  ✓ Locked\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

vaultCmd
  .command("change-passphrase")
  .description("Change the vault passphrase (admin only, vault must be unlocked)")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    let pass = "";
    for (;;) {
      pass = await promptSecret("  New passphrase (min 6 chars): ");
      if (pass.length < 6) { console.log(warn("  Too short — at least 6 characters.")); continue; }
      const c = await promptSecret("  Confirm: ");
      if (c !== pass) { console.log(warn("  Passphrases don't match — try again.")); continue; }
      break;
    }
    const stop = spinner("Changing…");
    try {
      await api.vaultChangePassphrase(pass);
      stop();
      console.log(ok("\n  ✓ Passphrase changed\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── LLM provider API keys ──────────────────────────────────────────────────────

const keysCmd = program.command("keys").description("Manage cloud LLM provider API keys");

keysCmd
  .command("list", { isDefault: true })
  .description("Show which providers have a key configured")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const { configured } = await api.listApiKeys();
      stop();
      console.log("\n" + brand + "  " + dim("provider keys"));
      divider();
      for (const p of ["openai", "anthropic", "google"]) {
        const set = configured.includes(p);
        console.log(`  ${set ? ok("●") : dim("○")}  ${p.padEnd(12)} ${set ? ok("configured") : dim("not set")}`);
      }
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

keysCmd
  .command("set <provider>")
  .description("Set an API key (openai, anthropic, or google)")
  .option("-k, --key <key>")
  .action(async (provider: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const key = opts.key || await promptSecret(`  ${provider} API key: `);
    const stop = spinner("Saving…");
    try {
      const res = await api.setApiKey(provider, key);
      stop();
      if (res.error) { console.error(error(`\n  ${res.error}\n`)); process.exit(1); }
      console.log(ok(`\n  ✓ ${provider} key saved\n`));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

keysCmd
  .command("remove <provider>")
  .description("Remove a saved API key")
  .action(async (provider: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Removing…");
    try {
      await api.removeApiKey(provider);
      stop();
      console.log(ok(`\n  ✓ ${provider} key removed\n`));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

// ── admin ──────────────────────────────────────────────────────────────────────

const adminCmd = program.command("admin").description("Server administration (admin users only)");

adminCmd
  .command("users")
  .description("List all users")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const users = await api.adminListUsers();
      stop();
      console.log("\n" + brand + "  " + dim(`${users.length} users`));
      divider();
      for (const u of users) {
        console.log(`  ${accent(u.displayName.padEnd(20))} ${dim("@" + u.username)}  ${u.role === "admin" ? kleur.yellow("admin") : dim("user")}  ${dim(u.id.slice(0, 8))}`);
      }
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

adminCmd
  .command("reset-password <userId>")
  .description("Reset a user's password")
  .option("-p, --password <pass>")
  .action(async (userId: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const password = opts.password || await promptSecret("  New password (min 4 chars): ");
    const stop = spinner("Resetting…");
    try {
      await api.adminResetPassword(userId, password);
      stop();
      console.log(ok("\n  ✓ Password reset\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

adminCmd
  .command("delete-user <userId>")
  .description("Delete a user account")
  .option("-y, --yes", "Skip confirmation")
  .action(async (userId: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    if (!opts.yes) {
      const ans = await prompt("  Delete this user? (yes/no): ");
      if (ans !== "yes") { console.log(dim("  Cancelled.\n")); return; }
    }
    const stop = spinner("Deleting…");
    try {
      await api.adminDeleteUser(userId);
      stop();
      console.log(ok("\n  ✓ Deleted\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

adminCmd
  .command("models")
  .description("List all models with provider config status")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const res = await api.adminListModels();
      stop();
      console.log("\n" + brand + "  " + dim("models"));
      divider();
      console.log(`  ${dim("ollama")}   ${res.ollamaOnline ? ok("online") : kleur.red("offline")}`);
      console.log(`  ${dim("default")}  ${accent(res.defaultModel)}`);
      console.log(`  ${dim("providers")} ${res.configuredProviders.join(", ") || dim("none")}`);
      console.log();
      for (const m of res.models) {
        const isDefault = m.id === res.defaultModel;
        console.log(`  ${isDefault ? ok("●") : dim("○")}  ${m.id}${m.label ? dim(` (${m.label})`) : ""}`);
      }
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

adminCmd
  .command("set-default-model <model>")
  .action(async (model: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Setting…");
    try {
      await api.adminSetDefaultModel(model);
      stop();
      console.log(ok(`\n  ✓ Default model set to ${model}\n`));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

adminCmd
  .command("delete-model <name>")
  .option("-y, --yes", "Skip confirmation")
  .action(async (name: string, opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    if (!opts.yes) {
      const ans = await prompt(`  Delete model "${name}" from Ollama? (yes/no): `);
      if (ans !== "yes") { console.log(dim("  Cancelled.\n")); return; }
    }
    const stop = spinner("Deleting…");
    try {
      await api.adminDeleteModel(name);
      stop();
      console.log(ok("\n  ✓ Deleted\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

adminCmd
  .command("settings")
  .description("Show global settings")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const s = await api.adminGetSettings();
      stop();
      console.log("\n" + brand + "  " + dim("settings"));
      divider();
      console.log(`  ${dim("defaultModel")}      ${accent(s.defaultModel)}`);
      console.log(`  ${dim("chatToolsEnabled")}  ${s.chatToolsEnabled ? ok("yes") : dim("no")}`);
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

adminCmd
  .command("set-setting")
  .description("Update a global setting")
  .option("--chat-tools-enabled <bool>", "true/false")
  .action(async (opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Updating…");
    try {
      const patch: Record<string, unknown> = {};
      if (opts.chatToolsEnabled !== undefined) patch.chatToolsEnabled = opts.chatToolsEnabled === "true";
      await api.adminUpdateSettings(patch);
      stop();
      console.log(ok("\n  ✓ Updated\n"));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

adminCmd
  .command("connections")
  .description("List connections' global enabled state")
  .action(async () => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Loading…");
    try {
      const conns = await api.adminGetConnections();
      stop();
      console.log("\n" + brand + "  " + dim("connections (global)"));
      divider();
      for (const c of conns) {
        console.log(`  ${c.enabled ? ok("●") : dim("○")}  ${c.name.padEnd(16)} ${c.enabled ? ok("enabled") : dim("disabled")}`);
      }
      console.log();
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

adminCmd
  .command("toggle-connection <id> <state>")
  .description("Enable or disable a connection globally — state: on/off")
  .action(async (id: string, state: string) => {
    const { token } = loadConfig();
    ensureAuth(token);
    const stop = spinner("Updating…");
    try {
      await api.adminToggleConnection(id, state === "on" || state === "true");
      stop();
      console.log(ok(`\n  ✓ ${id} ${state === "on" || state === "true" ? "enabled" : "disabled"}\n`));
    } catch (e) {
      stop();
      console.error(error(`\n  ${(e as Error).message}\n`));
      process.exit(1);
    }
  });

adminCmd
  .command("reset")
  .description("DANGER: wipe all user data (schema is preserved)")
  .option("-y, --yes", "Skip confirmation")
  .action(async (opts) => {
    const { token } = loadConfig();
    ensureAuth(token);
    if (!opts.yes) {
      const ans = await prompt(kleur.red("  Type \"reset\" to wipe ALL data: "));
      if (ans !== "reset") { console.log(dim("  Cancelled.\n")); return; }
    }
    const stop = spinner("Resetting…");
    try {
      const res = await api.adminReset();
      stop();
      console.log(ok(`\n  ✓ ${res.message}\n`));
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
          // Prefix match against the user's chats
          const all = await api.listChats();
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
        convoId = (await api.createChat()).id;
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

/** Pull a model, rendering live progress on one line. */
async function pullWithProgress(model: string) {
  process.stdout.write(dim(`\n  Downloading ${model}…\n`));
  try {
    for await (const ev of streamSse("/api/models/pull", { model })) {
      if (ev.error) { process.stdout.write("\r\x1b[K" + error(`  ✗ ${ev.error}\n`)); return; }
      if (ev.done)  { process.stdout.write("\r\x1b[K" + ok(`  ✓ ${model} downloaded\n`)); return; }
      if (ev.status) {
        const pct = typeof ev.total === "number" && ev.total > 0
          ? Math.round(((ev.completed ?? 0) / ev.total) * 100) : null;
        process.stdout.write(`\r\x1b[K  ${purple("⬇")} ${ev.status}${pct != null ? `  ${pct}%` : ""}`);
      }
    }
  } catch (e) {
    process.stdout.write("\r\x1b[K" + error(`  ✗ ${(e as Error).message}\n`));
  }
}

/** Resolve a full agent ID or a short prefix/name to the full agent record. */
async function resolveAgentId(idOrPrefix: string) {
  if (idOrPrefix.length >= 36) {
    const a = await api.getAgent(idOrPrefix);
    return a;
  }
  const all = await api.listAgents();
  const match = all.find((a) => a.id.startsWith(idOrPrefix) || a.name.toLowerCase() === idOrPrefix.toLowerCase());
  if (!match) throw new Error(`No agent found matching "${idOrPrefix}" — run: enzo-ai agents`);
  return match;
}

/** Resolve a full chat ID or a short prefix to the full chat record. */
async function resolveChatId(idOrPrefix: string) {
  if (idOrPrefix.length >= 36) return { id: idOrPrefix, title: idOrPrefix };
  const all = await api.listChats();
  const match = all.find((c) => c.id.startsWith(idOrPrefix));
  if (!match) throw new Error(`No chat found with ID starting "${idOrPrefix}" — run: enzo-ai chats`);
  return match;
}

// ── Entry ─────────────────────────────────────────────────────────────────────

program.addHelpText("beforeAll", "\n" + brand + "  " + dim("local-first AI  ·  v3.1.2") + "\n");
program.parse(process.argv);
if (!process.argv.slice(2).length) program.help();
