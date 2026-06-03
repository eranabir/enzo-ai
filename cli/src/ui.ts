import kleur from "kleur";
import * as readline from "node:readline";

// ── Brand colours (ANSI escapes for the accent purple) ───────────────────────
const PURPLE = "\x1b[38;2;109;94;252m";
const PURPLE2 = "\x1b[38;2;139;125;255m";
const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";

export const accent  = (s: string) => `${PURPLE2}${s}${RESET}`;
export const brand   = `${BOLD}${PURPLE}⬡ enzo ai${RESET}`;
export const dim     = (s: string) => kleur.gray(s);
export const ok      = (s: string) => kleur.green(s);
export const warn    = (s: string) => kleur.yellow(s);
export const error   = (s: string) => kleur.red(s);
export const bold    = (s: string) => `${BOLD}${s}${RESET}`;
export const purple  = (s: string) => `${PURPLE}${s}${RESET}`;
export const purple2 = (s: string) => `${PURPLE2}${s}${RESET}`;

export function divider(width = 52) {
  process.stdout.write(kleur.gray("─".repeat(width)) + "\n");
}

export function header(subtitle?: string) {
  console.log("\n" + brand + (subtitle ? "  " + dim(subtitle) : ""));
  divider();
}

// ── Spinner ───────────────────────────────────────────────────────────────────

export function spinner(text: string): () => void {
  const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  let i = 0;
  const iid = setInterval(() => {
    process.stdout.write(`\r${purple(frames[i++ % frames.length])} ${text}`);
  }, 80);
  return () => {
    clearInterval(iid);
    process.stdout.write("\r\x1b[K");
  };
}

// ── Prompts ───────────────────────────────────────────────────────────────────

export function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(bold(question), (ans) => { rl.close(); res(ans.trim()); });
  });
}

export function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(bold(question));
    process.stdin.setRawMode?.(true);
    let pw = "";
    process.stdin.on("data", function handler(ch: Buffer) {
      const c = ch.toString();
      if (c === "\r" || c === "\n") {
        process.stdin.setRawMode?.(false);
        process.stdin.off("data", handler);
        process.stdout.write("\n");
        rl.close();
        resolve(pw);
      } else if (c === "") {
        process.exit();
      } else if (c === "") {
        pw = pw.slice(0, -1);
      } else {
        pw += c;
      }
    });
    process.stdin.resume();
  });
}

export function chatInput(question: string): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => { rl.close(); resolve(ans ?? null); });
    rl.on("close", () => resolve(null));
  });
}

export function ensureAuth(token: string | null): asserts token is string {
  if (!token) {
    console.error(error("\nNot signed in. Run: enzo-ai login\n"));
    process.exit(1);
  }
}
