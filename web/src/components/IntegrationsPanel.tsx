import { useEffect, useState } from "react";
import { SiTelegram, SiDiscord } from "react-icons/si";
import { SlackIcon } from "./ui/SlackIcon";
import { api } from "../api";
import { ModelPicker } from "./ui/ModelPicker";
import { ConnectorCard, ConnectorSectionLabel } from "./ui/ConnectorCard";

const inputCls = "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent placeholder:text-muted";

type IntegrationId = "telegram" | "discord" | "slack";

interface IntegrationDef {
  id: IntegrationId;
  name: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "telegram",
    name: "Telegram",
    description: "Chat with your AI from anywhere via Telegram",
    icon: <SiTelegram className="h-6 w-6 text-[#2AABEE]" />,
    iconBg: "#fff",
  },
  {
    id: "discord",
    name: "Discord",
    description: "Bring Enzo AI into your Discord server or DMs",
    icon: <SiDiscord className="h-6 w-6 text-white" />,
    iconBg: "#5865F2",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Use Enzo AI directly in your Slack workspace",
    icon: <SlackIcon className="h-6 w-6" />,
    iconBg: "#fff",
  },
];

/**
 * Embeddable integrations manager — rendered inside the Admin panel's
 * Integrations tab. Switches between a connector-card grid and a per-service
 * connection screen, mirroring the MCP Servers UI.
 */
export function IntegrationsManager() {
  const [selected, setSelected] = useState<IntegrationId | null>(null);
  const [running, setRunning] = useState<Record<IntegrationId, boolean>>({
    telegram: false, discord: false, slack: false,
  });

  function refresh() {
    api.admin.getTelegram().then(d => setRunning(r => ({ ...r, telegram: d.enabled }))).catch(() => {});
    api.admin.getDiscord().then(d => setRunning(r => ({ ...r, discord: d.enabled }))).catch(() => {});
    api.admin.getSlack().then(d => setRunning(r => ({ ...r, slack: d.enabled }))).catch(() => {});
  }

  useEffect(() => { refresh(); }, []);

  const def = INTEGRATIONS.find(i => i.id === selected);

  // ── Detail / connection view ────────────────────────────────────────────────
  if (selected && def) {
    return (
      <div className="flex flex-col gap-5">
        <button onClick={() => { setSelected(null); refresh(); }} className="self-start text-sm text-muted hover:text-fg transition-colors">← Back</button>

        {/* Icon + name (same as MCP detail) */}
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-border" style={{ background: def.iconBg }}>
            {def.icon}
          </div>
          <div>
            <h2 className="text-lg font-bold">{def.name}</h2>
            <p className="text-sm text-muted">{def.description}</p>
          </div>
        </div>

        {selected === "telegram" && <TelegramConfig />}
        {selected === "discord" && <DiscordConfig />}
        {selected === "slack" && <SlackConfig />}
      </div>
    );
  }

  // ── Grid view ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <ConnectorSectionLabel>Available</ConnectorSectionLabel>
      <div className="grid grid-cols-2 gap-3">
        {INTEGRATIONS.map(i => (
          <ConnectorCard
            key={i.id}
            icon={i.icon}
            iconBg={i.iconBg}
            name={i.name}
            description={i.description}
            added={running[i.id]}
            addedLabel="Connected"
            onClick={() => setSelected(i.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Telegram config ─────────────────────────────────────────────────────────────

function TelegramConfig() {
  const [token, setToken] = useState("");
  const [allowedIds, setAllowed] = useState("");
  const [model, setModel] = useState("");
  const [running, setRunning] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [botName, setBotName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin.getTelegram().then(d => {
      setRunning(d.enabled); setAllowed(d.allowedIds); setModel(d.model); setHasToken(!!d.token);
    }).catch(() => {});
  }, []);

  async function save() {
    if (!token.trim() && !hasToken) return;
    setBusy(true); setError(null);
    try {
      const body: { token?: string; allowedIds: string; model: string } = { allowedIds, model };
      if (token.trim()) body.token = token;
      const res = await api.admin.saveTelegram(body);
      setRunning(res.running); setHasToken(true);
      if (res.username) setBotName(res.username);
      setToken("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    try { await api.admin.stopTelegram(); setRunning(false); setBotName(null); }
    finally { setBusy(false); }
  }

  return (
    <>
      {running && (
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
          <p className="text-sm font-semibold text-ok">✓ Bot {botName ? `@${botName}` : ""} is live</p>
          <p className="mt-0.5 text-xs text-muted">Open Telegram and message it — it replies with your local AI.</p>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Bot Token</label>
          <p className="mb-1.5 text-[11px] text-muted">Get one from <span className="text-accent-2">@BotFather</span> on Telegram → /newbot</p>
          <input className={inputCls} type="password"
            placeholder={hasToken ? "••••••••  (configured — paste to replace)" : "Paste your bot token"}
            value={token} onChange={e => setToken(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Allowed User IDs <span className="font-normal">(optional)</span></label>
          <p className="mb-1.5 text-[11px] text-muted">Blank = anyone can use it. Your ID via <span className="text-accent-2">@userinfobot</span></p>
          <input className={inputCls} placeholder="123456789, 987654321" value={allowedIds} onChange={e => setAllowed(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Model</label>
          <ModelPicker value={model} onChange={setModel} />
        </div>
        <ActionRow busy={busy} running={running} onSave={save} onStop={stop} canSave={!!token.trim() || hasToken} />
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </>
  );
}

// ── Discord config ──────────────────────────────────────────────────────────────

function DiscordConfig() {
  const [token, setToken] = useState("");
  const [allowedIds, setAllowed] = useState("");
  const [model, setModel] = useState("");
  const [running, setRunning] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [botTag, setBotTag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin.getDiscord().then(d => {
      setRunning(d.enabled); setAllowed(d.allowedIds); setModel(d.model); setHasToken(!!d.token);
    }).catch(() => {});
  }, []);

  async function save() {
    if (!token.trim() && !hasToken) return;
    setBusy(true); setError(null);
    try {
      const body: { token?: string; allowedIds: string; model: string; reconnect?: boolean } = { allowedIds, model };
      if (token.trim()) body.token = token;
      if (running && !token.trim()) body.reconnect = true;
      const res = await api.admin.saveDiscord(body);
      setRunning(res.running); setHasToken(true);
      if (res.tag) setBotTag(res.tag);
      setToken("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    try { await api.admin.stopDiscord(); setRunning(false); setBotTag(null); }
    finally { setBusy(false); }
  }

  return (
    <>
      {running && (
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
          <p className="text-sm font-semibold text-ok">✓ Bot {botTag ?? ""} is live</p>
          <p className="mt-0.5 text-xs text-muted">@mention the bot in any channel, or DM it directly.</p>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Bot Token</label>
          <p className="mb-1.5 text-[11px] text-muted">Get from <span className="text-accent-2">discord.com/developers/applications</span> → your app → Bot → Reset Token</p>
          <input className={inputCls} type="password"
            placeholder={hasToken ? "••••••••  (configured — paste to replace)" : "Paste your bot token"}
            value={token} onChange={e => setToken(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Allowed User IDs <span className="font-normal">(optional)</span></label>
          <p className="mb-1.5 text-[11px] text-muted">Right-click your name → Copy User ID (needs Developer Mode on).</p>
          <input className={inputCls} placeholder="123456789012345678" value={allowedIds} onChange={e => setAllowed(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Model</label>
          <ModelPicker value={model} onChange={setModel} />
        </div>
        <ActionRow busy={busy} running={running} onSave={save} onStop={stop} canSave={!!token.trim() || hasToken} />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-muted space-y-1.5">
          <p className="font-semibold text-fg">Setup checklist</p>
          <p>1. Enable <span className="text-fg">Message Content Intent</span> in your bot settings</p>
          <p>2. Invite bot with permissions: Read Messages, Send Messages</p>
          <p>3. In servers: @mention the bot · In DMs: just message it</p>
        </div>
      </div>
    </>
  );
}

// ── Slack config ────────────────────────────────────────────────────────────────

function SlackConfig() {
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [allowedIds, setAllowed] = useState("");
  const [model, setModel] = useState("");
  const [running, setRunning] = useState(false);
  const [hasTokens, setHasTokens] = useState(false);
  const [botName, setBotName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.admin.getSlack().then(d => {
      setRunning(d.enabled); setAllowed(d.allowedIds); setModel(d.model);
      setHasTokens(!!(d.botToken && d.appToken));
    }).catch(() => {});
  }, []);

  async function save() {
    if (!botToken.trim() && !appToken.trim() && !hasTokens) return;
    setBusy(true); setError(null);
    try {
      const body: Record<string, string | boolean> = { allowedIds, model };
      if (botToken.trim()) body.botToken = botToken;
      if (appToken.trim()) body.appToken = appToken;
      if (running && !botToken.trim() && !appToken.trim()) body.reconnect = true;
      const res = await api.admin.saveSlack(body as any);
      setRunning(res.running); setHasTokens(true);
      if (res.botName) setBotName(res.botName);
      setBotToken(""); setAppToken("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    try { await api.admin.stopSlack(); setRunning(false); setBotName(null); }
    finally { setBusy(false); }
  }

  return (
    <>
      {running && (
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
          <p className="text-sm font-semibold text-ok">✓ Bot @{botName ?? "enzo-ai"} is live</p>
          <p className="mt-0.5 text-xs text-muted">Message the bot directly or mention it in channels.</p>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Bot Token <span className="font-normal">(xoxb-...)</span></label>
          <p className="mb-1.5 text-[11px] text-muted">api.slack.com/apps → OAuth & Permissions → Bot User OAuth Token</p>
          <input className={inputCls} type="password"
            placeholder={hasTokens ? "••••••••  (configured)" : "xoxb-..."}
            value={botToken} onChange={e => setBotToken(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">App-Level Token <span className="font-normal">(xapp-...)</span></label>
          <p className="mb-1.5 text-[11px] text-muted">Basic Information → App-Level Tokens → create with <code className="bg-surface px-1 rounded text-[10px]">connections:write</code></p>
          <input className={inputCls} type="password"
            placeholder={hasTokens ? "••••••••  (configured)" : "xapp-..."}
            value={appToken} onChange={e => setAppToken(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Allowed Channel / User IDs <span className="font-normal">(optional)</span></label>
          <input className={inputCls} placeholder="C1234567890, U1234567890" value={allowedIds} onChange={e => setAllowed(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Model</label>
          <ModelPicker value={model} onChange={setModel} />
        </div>
        <ActionRow busy={busy} running={running} onSave={save} onStop={stop} canSave={!!botToken.trim() || !!appToken.trim() || hasTokens} />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-muted space-y-1.5">
          <p className="font-semibold text-fg">Setup checklist</p>
          <p>1. Enable <span className="text-fg">Socket Mode</span> in your app settings</p>
          <p>2. Bot events: <code className="bg-surface px-1 rounded text-[10px]">message.channels</code>, <code className="bg-surface px-1 rounded text-[10px]">message.im</code></p>
          <p>3. Scopes: <code className="bg-surface px-1 rounded text-[10px]">chat:write</code>, <code className="bg-surface px-1 rounded text-[10px]">channels:history</code>, <code className="bg-surface px-1 rounded text-[10px]">im:history</code></p>
          <p>4. Install app · 5. <code className="bg-surface px-1 rounded text-[10px]">/invite @yourbot</code></p>
        </div>
      </div>
    </>
  );
}

// ── Shared action row ───────────────────────────────────────────────────────────

function ActionRow({ busy, running, onSave, onStop, canSave }: {
  busy: boolean; running: boolean; onSave: () => void; onStop: () => void; canSave: boolean;
}) {
  return (
    <div className="flex gap-2">
      <button onClick={onSave} disabled={busy || !canSave}
        className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-2 disabled:opacity-40 disabled:cursor-not-allowed">
        {busy ? "Connecting…" : running ? "Save & Reconnect" : "Save & Connect"}
      </button>
      {running && (
        <button onClick={onStop} disabled={busy}
          className="rounded-xl border border-danger/40 bg-danger/10 px-4 text-sm font-semibold text-danger hover:bg-danger/20 disabled:opacity-50">
          Disconnect
        </button>
      )}
    </div>
  );
}
