import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".enzo-ai");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Config {
  serverUrl: string;
  token: string | null;
  username: string | null;
}

const DEFAULTS: Config = {
  serverUrl: process.env.ENZO_AI_URL ?? "http://127.0.0.1:1616",
  token: null,
  username: null,
};

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(patch: Partial<Config>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const current = loadConfig();
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...current, ...patch }, null, 2));
}

export function clearAuth(): void {
  saveConfig({ token: null, username: null });
}
