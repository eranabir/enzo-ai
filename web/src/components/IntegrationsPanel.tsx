import { useEffect, useState } from "react";
import { api } from "../api";
import { useConfirm } from "./ui/ConfirmProvider";

const inputCls = "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent placeholder:text-muted";

// Telegram / Discord / Slack are now per-user integrations, configured in
// Settings → Connections. The config components below are rendered there.

/**
 * A token input. When a value is already saved it shows a masked "configured"
 * placeholder so the user can see it's set; typing a new value replaces it,
 * leaving it blank keeps the existing token.
 */
function TokenField({ hasValue, value, onChange, placeholder }: {
  hasValue: boolean; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <input
      className={inputCls}
      type="password"
      placeholder={hasValue ? "•••••••••••••• · configured" : placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ── Telegram config ─────────────────────────────────────────────────────────────

export function TelegramConfig() {
  const confirm = useConfirm();
  const [token, setToken] = useState("");
  const [allowedIds, setAllowed] = useState("");
  const [running, setRunning] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [botName, setBotName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.telegram.status().then(d => {
      setRunning(d.enabled); setAllowed(d.allowedIds); setHasToken(!!d.token);
      if (d.username) setBotName(d.username);
    }).catch(() => {});
  }, []);

  async function save() {
    if (!token.trim() && !hasToken) return;
    setBusy(true); setError(null);
    try {
      const body: { token?: string; allowedIds: string } = { allowedIds };
      if (token.trim()) body.token = token;
      const res = await api.telegram.save(body);
      setRunning(res.running); setHasToken(true);
      if (res.username) setBotName(res.username);
      setToken("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!(await confirm({ title: "Remove Telegram connection?", description: "The saved bot token and all chats it created will be deleted.", confirmText: "Remove", danger: true }))) return;
    setBusy(true); setError(null);
    try {
      await api.telegram.disconnect();
      setRunning(false); setHasToken(false); setBotName(null);
      setToken(""); setAllowed("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      {running ? (
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
          <p className="text-sm font-semibold text-ok">✓ Bot {botName ? `@${botName}` : ""} is live</p>
          <p className="mt-0.5 text-xs text-muted">Open Telegram and message it — it replies with your local AI.</p>
        </div>
      ) : hasToken ? (
        <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
          <p className="text-sm font-semibold text-fg">● Configured{botName ? ` — @${botName}` : ""}</p>
          <p className="mt-0.5 text-xs text-muted">A bot token is saved but the bot isn't running. Save to reconnect.</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Bot Token</label>
          <p className="mb-1.5 text-[11px] text-muted">Get one from <span className="text-accent-2">@BotFather</span> on Telegram → /newbot</p>
          <TokenField hasValue={hasToken} value={token} onChange={setToken} placeholder="Paste your bot token" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Allowed User IDs <span className="font-normal">(optional)</span></label>
          <p className="mb-1.5 text-[11px] text-muted">Blank = anyone can use it. Your ID via <span className="text-accent-2">@userinfobot</span></p>
          <input className={inputCls} placeholder="123456789, 987654321" value={allowedIds} onChange={e => setAllowed(e.target.value)} />
        </div>
        <ActionRow busy={busy} running={running} configured={running || hasToken} onSave={save} onRemove={remove} canSave={!!token.trim() || hasToken} />
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </>
  );
}

// ── Discord config ──────────────────────────────────────────────────────────────

export function DiscordConfig() {
  const confirm = useConfirm();
  const [token, setToken] = useState("");
  const [allowedIds, setAllowed] = useState("");
  const [running, setRunning] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [botTag, setBotTag] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.discord.status().then(d => {
      setRunning(d.enabled); setAllowed(d.allowedIds); setHasToken(!!d.token);
      if (d.tag) setBotTag(d.tag);
    }).catch(() => {});
  }, []);

  async function save() {
    if (!token.trim() && !hasToken) return;
    setBusy(true); setError(null);
    try {
      const body: { token?: string; allowedIds: string } = { allowedIds };
      if (token.trim()) body.token = token;
      const res = await api.discord.save(body);
      setRunning(res.running); setHasToken(true);
      if (res.tag) setBotTag(res.tag);
      setToken("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!(await confirm({ title: "Remove Discord connection?", description: "The saved bot token and all chats it created will be deleted.", confirmText: "Remove", danger: true }))) return;
    setBusy(true); setError(null);
    try {
      await api.discord.disconnect();
      setRunning(false); setHasToken(false); setBotTag(null);
      setToken(""); setAllowed("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      {running ? (
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
          <p className="text-sm font-semibold text-ok">✓ Bot {botTag ?? ""} is live</p>
          <p className="mt-0.5 text-xs text-muted">@mention the bot in any channel, or DM it directly.</p>
        </div>
      ) : hasToken ? (
        <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
          <p className="text-sm font-semibold text-fg">● Configured{botTag ? ` — ${botTag}` : ""}</p>
          <p className="mt-0.5 text-xs text-muted">A bot token is saved but the bot isn't running. Save to reconnect.</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Bot Token</label>
          <p className="mb-1.5 text-[11px] text-muted">Get from <span className="text-accent-2">discord.com/developers/applications</span> → your app → Bot → Reset Token</p>
          <TokenField hasValue={hasToken} value={token} onChange={setToken} placeholder="Paste your bot token" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Allowed User IDs <span className="font-normal">(optional)</span></label>
          <p className="mb-1.5 text-[11px] text-muted">Right-click your name → Copy User ID (needs Developer Mode on).</p>
          <input className={inputCls} placeholder="123456789012345678" value={allowedIds} onChange={e => setAllowed(e.target.value)} />
        </div>
        <ActionRow busy={busy} running={running} configured={running || hasToken} onSave={save} onRemove={remove} canSave={!!token.trim() || hasToken} />
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

export function SlackConfig() {
  const confirm = useConfirm();
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [allowedIds, setAllowed] = useState("");
  const [running, setRunning] = useState(false);
  const [hasTokens, setHasTokens] = useState(false);
  const [botName, setBotName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.slack.status().then(d => {
      setRunning(d.enabled); setAllowed(d.allowedIds);
      setHasTokens(!!(d.botToken && d.appToken));
      if (d.botName) setBotName(d.botName);
    }).catch(() => {});
  }, []);

  async function save() {
    if (!botToken.trim() && !appToken.trim() && !hasTokens) return;
    setBusy(true); setError(null);
    try {
      const body: { botToken?: string; appToken?: string; allowedIds: string } = { allowedIds };
      if (botToken.trim()) body.botToken = botToken;
      if (appToken.trim()) body.appToken = appToken;
      const res = await api.slack.save(body);
      setRunning(res.running); setHasTokens(true);
      if (res.botName) setBotName(res.botName);
      setBotToken(""); setAppToken("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!(await confirm({ title: "Remove Slack connection?", description: "The saved tokens and all chats it created will be deleted.", confirmText: "Remove", danger: true }))) return;
    setBusy(true); setError(null);
    try {
      await api.slack.disconnect();
      setRunning(false); setHasTokens(false); setBotName(null);
      setBotToken(""); setAppToken(""); setAllowed("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      {running ? (
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
          <p className="text-sm font-semibold text-ok">✓ Bot @{botName ?? "enzo-ai"} is live</p>
          <p className="mt-0.5 text-xs text-muted">Message the bot directly or mention it in channels.</p>
        </div>
      ) : hasTokens ? (
        <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
          <p className="text-sm font-semibold text-fg">● Configured{botName ? ` — @${botName}` : ""}</p>
          <p className="mt-0.5 text-xs text-muted">Tokens are saved but the app isn't running. Save to reconnect.</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Bot Token <span className="font-normal">(xoxb-...)</span></label>
          <p className="mb-1.5 text-[11px] text-muted">api.slack.com/apps → OAuth & Permissions → Bot User OAuth Token</p>
          <TokenField hasValue={hasTokens} value={botToken} onChange={setBotToken} placeholder="xoxb-..." />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">App-Level Token <span className="font-normal">(xapp-...)</span></label>
          <p className="mb-1.5 text-[11px] text-muted">Basic Information → App-Level Tokens → create with <code className="bg-surface px-1 rounded text-[10px]">connections:write</code></p>
          <TokenField hasValue={hasTokens} value={appToken} onChange={setAppToken} placeholder="xapp-..." />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Allowed Channel / User IDs <span className="font-normal">(optional)</span></label>
          <input className={inputCls} placeholder="C1234567890, U1234567890" value={allowedIds} onChange={e => setAllowed(e.target.value)} />
        </div>
        <ActionRow busy={busy} running={running} configured={running || hasTokens} onSave={save} onRemove={remove} canSave={!!botToken.trim() || !!appToken.trim() || hasTokens} />
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

function ActionRow({ busy, running, configured, onSave, onRemove, canSave }: {
  busy: boolean; running: boolean; configured: boolean; onSave: () => void; onRemove: () => void; canSave: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button onClick={onSave} disabled={busy || !canSave}
          className="flex-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-2 disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? "Connecting…" : running ? "Save & Reconnect" : "Save & Connect"}
        </button>
      </div>
      {configured && (
        <button onClick={onRemove} disabled={busy}
          className="rounded-xl border border-danger/40 bg-danger/10 py-2 text-sm font-semibold text-danger transition-colors hover:bg-danger/20 disabled:opacity-50">
          Remove connection &amp; delete its chats
        </button>
      )}
    </div>
  );
}
