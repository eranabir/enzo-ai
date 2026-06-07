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

program
  .command("chats")
  .alias("chats")
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

// ── connections ─────────────────────────────────────────────────────────────────

program
  .command("connections")
  .alias("integrations")
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
      console.log(dim("  Configure connections in: Settings → Connections"));
      console.log();
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

// ── Entry ─────────────────────────────────────────────────────────────────────

program.addHelpText("beforeAll", "\n" + brand + "  " + dim("local-first AI  ·  v0.1.0") + "\n");
program.parse(process.argv);
if (!process.argv.slice(2).length) program.help();
