import { useEffect, useState } from "react";
import { useConfirm } from "./ui/ConfirmProvider";
import { Zap, MessageSquare, Brain, Trash2, RotateCcw, User, Plug } from "lucide-react";
import { api, getToken } from "../api";
import type { Memory, User as UserType } from "../types";
import { ModalHeader, BackButton } from "./ui/ModalHeader";
import { Label } from "./ui/Label";
import { ConnectorCard, ConnectorSectionLabel } from "./ui/ConnectorCard";
import { TelegramConfig, DiscordConfig, SlackConfig } from "./IntegrationsPanel";
import { SiTelegram, SiDiscord } from "react-icons/si";
import { SlackIcon } from "./ui/SlackIcon";
import { APPS, appCallbackUrl } from "../apps";

const inputCls =
  "w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-fg outline-none placeholder:text-muted focus:border-accent transition-colors";

interface Props {
  open: boolean;
  user: UserType;
  onClose: () => void;
  onUpdated: (user: UserType) => void;
}

/** Build form values from a user, falling back sensibly for null fields. */
function toForm(u: UserType) {
  return {
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    superPowers: u.superPowers ?? "",
    about: u.about ?? "",
    assistantStyle: u.assistantStyle ?? "",
  };
}

export function SettingsPanel({ open, user, onClose, onUpdated }: Props) {
  const confirm = useConfirm();
  const [form, setForm] = useState(() => toForm(user));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"profile" | "memory" | "connections">("profile");
  const [calStatus, setCalStatus] = useState<{ available?: boolean; hasCredentials: boolean; connected: boolean; email?: string } | null>(null);
  const [calClientId, setCalClientId]         = useState("");
  const [calClientSecret, setCalClientSecret] = useState("");
  const [calBusy, setCalBusy] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [gmStatus, setGmStatus] = useState<{ available?: boolean; hasCredentials: boolean; connected: boolean; email?: string } | null>(null);
  const [gmClientId, setGmClientId]         = useState("");
  const [gmClientSecret, setGmClientSecret] = useState("");
  const [gmBusy, setGmBusy] = useState(false);
  const [gmOpen, setGmOpen] = useState(false);
  const [gmAvail, setGmAvail] = useState(true);
  const [tgOpen, setTgOpen] = useState(false);
  const [tgConnected, setTgConnected] = useState(false);
  const [tgAvail, setTgAvail] = useState(true);
  const [dcOpen, setDcOpen] = useState(false);
  const [dcConnected, setDcConnected] = useState(false);
  const [dcAvail, setDcAvail] = useState(true);
  const [slOpen, setSlOpen] = useState(false);
  const [slConnected, setSlConnected] = useState(false);
  const [slAvail, setSlAvail] = useState(true);
  const [calAvail, setCalAvail] = useState(true);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesBusy, setMemoriesBusy] = useState(false);


  // Re-sync form when the panel opens or the user object changes (e.g. after a save).
  useEffect(() => {
    if (open) {
      setForm(toForm(user));
      setSaved(false);
      setError(null);
      setTab("profile");
      setCalOpen(false);
      setGmOpen(false);
      setTgOpen(false);
      setDcOpen(false);
      setSlOpen(false);
      setCalStatus(null);
      setGmStatus(null);
    }
  }, [open, user]);

  useEffect(() => {
    if (open && tab === "memory") {
      api.memories.list().then(setMemories).catch(() => {});
    }
    if (open && tab === "connections") {
      api.calendar.status().then((s) => { setCalStatus(s); setCalAvail(s.available !== false); }).catch(() => {});
      api.gmail.status().then((s) => { setGmStatus(s); setGmAvail(s.available !== false); }).catch(() => {});
      api.telegram.status().then((d) => { setTgConnected(d.enabled || !!d.token); setTgAvail(d.available); }).catch(() => {});
      api.discord.status().then((d) => { setDcConnected(d.enabled || !!d.token); setDcAvail(d.available); }).catch(() => {});
      api.slack.status().then((d) => { setSlConnected(d.enabled || !!(d.botToken && d.appToken)); setSlAvail(d.available); }).catch(() => {});
    }
  }, [open, tab]);

  async function connectGoogle() {
    setCalBusy(true);
    try {
      const { url } = await api.calendar.authUrl();
      const popup = window.open(url, "google-calendar-auth", "width=500,height=650,left=400,top=100");
      const handler = (e: MessageEvent) => {
        if (e.data?.ok) {
          setCalStatus(s => s ? { ...s, connected: true, email: e.data.email } : null);
        } else if (e.data?.error) {
          alert(`Google Calendar connection failed: ${e.data.error}`);
        }
        window.removeEventListener("message", handler);
        popup?.close();
      };
      window.addEventListener("message", handler);
    } catch (e) { alert((e as Error).message); }
    finally { setCalBusy(false); }
  }

  async function disconnectGoogle() {
    await api.calendar.disconnect();
    setCalStatus(s => s ? { ...s, connected: false, email: undefined } : null);
  }

  async function connectGmail() {
    setGmBusy(true);
    try {
      const { url } = await api.gmail.authUrl();
      const popup = window.open(url, "google-gmail-auth", "width=500,height=650,left=400,top=100");
      const handler = (e: MessageEvent) => {
        if (e.data?.ok) {
          setGmStatus(s => s ? { ...s, connected: true, email: e.data.email } : null);
        } else if (e.data?.error) {
          alert(`Gmail connection failed: ${e.data.error}`);
        }
        window.removeEventListener("message", handler);
        popup?.close();
      };
      window.addEventListener("message", handler);
    } catch (e) { alert((e as Error).message); }
    finally { setGmBusy(false); }
  }

  async function disconnectGmail() {
    await api.gmail.disconnect();
    setGmStatus(s => s ? { ...s, connected: false, email: undefined } : null);
  }


  async function deleteMemory(id: string) {
    await api.memories.deleteOne(id);
    setMemories((prev) => prev.filter((m) => m.id !== id));
  }

  async function clearAllMemories() {
    if (!(await confirm({ title: "Clear all memories?", description: "Everything Enzo remembers about you will be permanently deleted. This cannot be undone.", confirmText: "Clear all", danger: true }))) return;
    setMemoriesBusy(true);
    await api.memories.clearAll().catch(() => {});
    setMemories([]);
    setMemoriesBusy(false);
  }

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      // PATCH /auth/me
      const updated = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-enzo-ai-token": getToken() ?? "",
        },
        body: JSON.stringify({
          displayName:
            [form.firstName, form.lastName].filter(Boolean).join(" ") ||
            user.username,
          ...form,
        }),
      }).then((r) => r.json());

      if (updated?.user) {
        onUpdated(updated.user);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4">
      <div className="flex h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <ModalHeader
          title="Settings"
          subtitle="Manage your profile and Enzo AI's memory."
          onClose={onClose}
        />

        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border px-6 pt-1">
          {(["profile", "memory", "connections"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm font-semibold capitalize transition-colors ${
                tab === t ? "border-b-2 border-accent text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {t === "profile" && <User className="h-3.5 w-3.5" />}
              {t === "memory" && <Brain className="h-3.5 w-3.5" />}
              {t === "connections" && <Plug className="h-3.5 w-3.5" />}
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
        {/* Memory tab */}
        {tab === "memory" && (
          <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">
                {memories.length === 0
                  ? "No memories yet — they build up as you chat."
                  : `${memories.length} stored ${memories.length === 1 ? "memory" : "memories"}`}
              </p>
              {memories.length > 0 && (
                <button
                  type="button"
                  onClick={clearAllMemories}
                  disabled={memoriesBusy}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:border-danger hover:text-danger disabled:opacity-40"
                >
                  <RotateCcw className="h-3 w-3" />
                  Clear all
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
              {memories.map((m) => (
                <div
                  key={m.id}
                  className="group flex items-start gap-2.5 rounded-xl border border-border bg-surface-2 px-3 py-2.5"
                >
                  <span className={`mt-0.5 flex-shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    m.type === "fact" ? "bg-blue-500/20 text-blue-400" :
                    m.type === "decision" ? "bg-amber-500/20 text-amber-400" :
                    m.type === "preference" ? "bg-purple-500/20 text-purple-400" :
                    "bg-green-500/20 text-green-400"
                  }`}>
                    {m.type.replace("_", " ")}
                  </span>
                  <p className="flex-1 text-sm text-fg leading-relaxed">{m.content}</p>
                  <button
                    type="button"
                    onClick={() => deleteMemory(m.id)}
                    className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100 text-muted hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Connections tab — grid */}
        {tab === "connections" && !calOpen && !gmOpen && !tgOpen && !dcOpen && !slOpen && (
          <div className="p-5">
            <ConnectorSectionLabel>Available</ConnectorSectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {tgAvail && <ConnectorCard
                icon={<SiTelegram className="h-7 w-7 text-[#2AABEE]" />}
                iconBg="#fff"
                name="Telegram"
                description="Chat with your AI from Telegram"
                added={tgConnected}
                addedLabel="Connected"
                onClick={() => setTgOpen(true)}
              />}
              {dcAvail && <ConnectorCard
                icon={<SiDiscord className="h-7 w-7 text-white" />}
                iconBg="#5865F2"
                name="Discord"
                description="Bring your AI into Discord"
                added={dcConnected}
                addedLabel="Connected"
                onClick={() => setDcOpen(true)}
              />}
              {slAvail && <ConnectorCard
                icon={<SlackIcon className="h-7 w-7" />}
                iconBg="#fff"
                name="Slack"
                description="Use your AI in Slack"
                added={slConnected}
                addedLabel="Connected"
                onClick={() => setSlOpen(true)}
              />}
              {calAvail && <ConnectorCard
                icon={
                  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
                    <rect width="48" height="48" rx="6" fill="#fff"/>
                    <rect x="5" y="13" width="38" height="30" rx="2" fill="#fff"/>
                    <rect x="5" y="5" width="38" height="13" rx="5" fill="#4285f4"/>
                    <rect x="5" y="10" width="38" height="8" fill="#4285f4"/>
                    <circle cx="13" cy="10" r="3" fill="#fff"/>
                    <circle cx="35" cy="10" r="3" fill="#fff"/>
                    <text x="24" y="32" textAnchor="middle" fontSize="12" fontWeight="800" fill="#4285f4" fontFamily="sans-serif">{new Date().getDate()}</text>
                  </svg>
                }
                iconBg="#fff"
                name={APPS.googleCalendar.name}
                description={APPS.googleCalendar.description}
                added={calStatus?.connected}
                addedLabel="Connected"
                onClick={() => {
                  setCalOpen(true);
                  if (!calStatus) api.calendar.status().then(setCalStatus).catch(() => {});
                }}
              />}
              {gmAvail && <ConnectorCard
                icon={
                  <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" width="28" height="28">
                    <rect width="48" height="48" rx="6" fill="#fff"/>
                    <path fill="#4285f4" d="M6 14v22h7V20l11 8 11-8v16h7V14l-4-3-14 10L10 11z"/>
                    <path fill="#34a853" d="M6 36h7V20l-7-5z"/>
                    <path fill="#fbbc04" d="M35 36h7V15l-7 5z"/>
                    <path fill="#ea4335" d="M13 14l11 8 11-8-4-3-7 5-7-5z"/>
                  </svg>
                }
                iconBg="#fff"
                name={APPS.gmail.name}
                description={APPS.gmail.description}
                added={gmStatus?.connected}
                addedLabel="Connected"
                onClick={() => {
                  setGmOpen(true);
                  if (!gmStatus) api.gmail.status().then(setGmStatus).catch(() => {});
                }}
              />}
            </div>
          </div>
        )}

        {/* Connections tab — Telegram detail */}
        {tab === "connections" && tgOpen && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <BackButton onClick={() => { setTgOpen(false); api.telegram.status().then((d) => setTgConnected(d.enabled || !!d.token)).catch(() => {}); }} />
            </div>
            <div className="flex flex-col gap-5 p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-border bg-white">
                  <SiTelegram className="h-9 w-9 text-[#2AABEE]" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Telegram</h2>
                  <p className="text-sm text-muted">Chat with your AI from Telegram — your own bot, your chats.</p>
                </div>
              </div>
              <TelegramConfig />
            </div>
          </div>
        )}

        {/* Connections tab — Discord detail */}
        {tab === "connections" && dcOpen && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <BackButton onClick={() => { setDcOpen(false); api.discord.status().then((d) => setDcConnected(d.enabled || !!d.token)).catch(() => {}); }} />
            </div>
            <div className="flex flex-col gap-5 p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-border" style={{ background: "#5865F2" }}>
                  <SiDiscord className="h-9 w-9 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Discord</h2>
                  <p className="text-sm text-muted">Bring your AI into your Discord server or DMs — your own bot.</p>
                </div>
              </div>
              <DiscordConfig />
            </div>
          </div>
        )}

        {/* Connections tab — Slack detail */}
        {tab === "connections" && slOpen && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <BackButton onClick={() => { setSlOpen(false); api.slack.status().then((d) => setSlConnected(d.enabled || !!(d.botToken && d.appToken))).catch(() => {}); }} />
            </div>
            <div className="flex flex-col gap-5 p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-border bg-white">
                  <SlackIcon className="h-9 w-9" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Slack</h2>
                  <p className="text-sm text-muted">Use your AI in your Slack workspace — your own app.</p>
                </div>
              </div>
              <SlackConfig />
            </div>
          </div>
        )}

        {/* Connections tab — Google Calendar detail */}
        {tab === "connections" && calOpen && (
          <div className="flex flex-col">
            {/* Back header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <BackButton onClick={() => setCalOpen(false)} />
            </div>

            <div className="p-6 flex flex-col gap-5">
              {/* Icon + name (same as MCP featured-detail) */}
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-border bg-white overflow-hidden">
                  <svg viewBox="0 0 48 48" width="40" height="40"><rect width="48" height="48" rx="8" fill="#fff"/><rect x="5" y="13" width="38" height="30" rx="2" fill="#fff"/><rect x="5" y="5" width="38" height="13" rx="5" fill="#4285f4"/><rect x="5" y="10" width="38" height="8" fill="#4285f4"/><circle cx="13" cy="10" r="3" fill="#fff"/><circle cx="35" cy="10" r="3" fill="#fff"/><text x="24" y="32" textAnchor="middle" fontSize="12" fontWeight="800" fill="#4285f4" fontFamily="sans-serif">{new Date().getDate()}</text></svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold">Google Calendar</h2>
                  <p className="text-sm text-muted">Read, create & update events from chat</p>
                </div>
              </div>

              {calStatus === null ? (
                <p className="text-xs text-muted">Loading…</p>
              ) : calStatus.connected ? (
                <>
                  <div className="flex items-center gap-3 rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
                    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                    <div>
                      <p className="text-xs font-semibold text-ok">Connected</p>
                      <p className="text-[11px] text-muted">{calStatus.email}</p>
                    </div>
                  </div>
                  <button onClick={disconnectGoogle} className="text-xs text-danger hover:underline text-left">Disconnect</button>
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-[11px] text-muted">
                    Create an OAuth app at <span className="text-accent-2">console.cloud.google.com</span> → add redirect URI:{" "}
                    <code className="bg-surface px-1 rounded text-[10px]">{appCallbackUrl(APPS.googleCalendar.id)}</code>
                  </div>
                  <div className="flex flex-col gap-3">
                    <p className="text-xs font-semibold text-muted">Required credentials</p>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-muted">Client ID</label>
                      <input className={inputCls} type="password"
                        placeholder={calStatus?.hasCredentials ? "Client ID ••••••••" : "Enter Client ID"}
                        value={calClientId} onChange={e => setCalClientId(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-muted">Client Secret</label>
                      <input className={inputCls} type="password"
                        placeholder={calStatus?.hasCredentials ? "Client Secret ••••••••" : "Enter Client Secret"}
                        value={calClientSecret} onChange={e => setCalClientSecret(e.target.value)} />
                    </div>
                    {(calClientId.trim() || calClientSecret.trim()) && (
                      <button onClick={async () => {
                        setCalBusy(true);
                        try {
                          await api.calendar.saveCredentials({ clientId: calClientId, clientSecret: calClientSecret });
                          setCalStatus(s => s ? { ...s, hasCredentials: true } : null);
                          setCalClientId(""); setCalClientSecret("");
                        } finally { setCalBusy(false); }
                      }} disabled={calBusy || !calClientId.trim() || !calClientSecret.trim()}
                        className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg border border-border hover:border-accent/60 disabled:opacity-40 self-start">
                        Save credentials
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Action footer (same as MCP detail) */}
            {calStatus && !calStatus.connected && (
              <div className="border-t border-border px-5 py-4">
                <button onClick={connectGoogle} disabled={calBusy || !calStatus?.hasCredentials}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
                  <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" opacity=".9"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/></svg>
                  {calBusy ? "Opening Google…" : calStatus?.hasCredentials ? "Sign in with Google" : "Save credentials first"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Connections tab — Gmail detail */}
        {tab === "connections" && gmOpen && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <BackButton onClick={() => setGmOpen(false)} />
            </div>

            <div className="p-6 flex flex-col gap-5">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-border bg-white overflow-hidden">
                  <svg viewBox="0 0 48 48" width="40" height="40"><rect width="48" height="48" rx="8" fill="#fff"/><path fill="#4285f4" d="M6 14v22h7V20l11 8 11-8v16h7V14l-4-3-14 10L10 11z"/><path fill="#34a853" d="M6 36h7V20l-7-5z"/><path fill="#fbbc04" d="M35 36h7V15l-7 5z"/><path fill="#ea4335" d="M13 14l11 8 11-8-4-3-7 5-7-5z"/></svg>
                </div>
                <div>
                  <h2 className="text-lg font-bold">Gmail</h2>
                  <p className="text-sm text-muted">Search & read your email from chat</p>
                </div>
              </div>

              {gmStatus === null ? (
                <p className="text-xs text-muted">Loading…</p>
              ) : gmStatus.connected ? (
                <>
                  <div className="flex items-center gap-3 rounded-xl border border-ok/30 bg-ok/10 px-4 py-3">
                    <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                    <div>
                      <p className="text-xs font-semibold text-ok">Connected</p>
                      <p className="text-[11px] text-muted">{gmStatus.email}</p>
                    </div>
                  </div>
                  <button onClick={disconnectGmail} className="text-xs text-danger hover:underline text-left">Disconnect</button>
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-[11px] text-muted">
                    Create an OAuth app at <span className="text-accent-2">console.cloud.google.com</span>, enable the Gmail API, then add redirect URI:{" "}
                    <code className="bg-surface px-1 rounded text-[10px]">{appCallbackUrl(APPS.gmail.id)}</code>
                  </div>
                  <div className="flex flex-col gap-3">
                    <p className="text-xs font-semibold text-muted">Required credentials</p>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-muted">Client ID</label>
                      <input className={inputCls} type="password"
                        placeholder={gmStatus?.hasCredentials ? "Client ID ••••••••" : "Enter Client ID"}
                        value={gmClientId} onChange={e => setGmClientId(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs text-muted">Client Secret</label>
                      <input className={inputCls} type="password"
                        placeholder={gmStatus?.hasCredentials ? "Client Secret ••••••••" : "Enter Client Secret"}
                        value={gmClientSecret} onChange={e => setGmClientSecret(e.target.value)} />
                    </div>
                    {(gmClientId.trim() || gmClientSecret.trim()) && (
                      <button onClick={async () => {
                        setGmBusy(true);
                        try {
                          await api.gmail.saveCredentials({ clientId: gmClientId, clientSecret: gmClientSecret });
                          setGmStatus(s => s ? { ...s, hasCredentials: true } : null);
                          setGmClientId(""); setGmClientSecret("");
                        } finally { setGmBusy(false); }
                      }} disabled={gmBusy || !gmClientId.trim() || !gmClientSecret.trim()}
                        className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-semibold text-fg border border-border hover:border-accent/60 disabled:opacity-40 self-start">
                        Save credentials
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {gmStatus && !gmStatus.connected && (
              <div className="border-t border-border px-5 py-4">
                <button onClick={connectGmail} disabled={gmBusy || !gmStatus?.hasCredentials}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
                  <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" opacity=".9"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/></svg>
                  {gmBusy ? "Opening Google…" : gmStatus?.hasCredentials ? "Sign in with Google" : "Save credentials first"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Profile tab */}
        {tab === "profile" && (
        <form onSubmit={save} className="flex flex-col gap-6 px-6 pt-5 pb-6">
          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          {/* ── Identity ── */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <User className="h-3.5 w-3.5" /> Identity
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-first">First name</Label>
                <input id="s-first" className={inputCls} placeholder="Jane"
                  value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-last">Last name</Label>
                <input id="s-last" className={inputCls} placeholder="Smith"
                  value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
              </div>
            </div>
          </div>

          {/* ── AI context ── */}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted">
              <Zap className="h-3.5 w-3.5" /> AI context
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-powers">
                ⚡ Super powers
                <span className="ml-1 font-normal text-muted/70">— your skills & expertise</span>
              </Label>
              <input id="s-powers" className={inputCls}
                placeholder="e.g. Full-stack dev, system design, coffee brewing"
                value={form.superPowers} onChange={(e) => set("superPowers", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-about">About you</Label>
              <textarea id="s-about" className={`${inputCls} resize-none`} rows={2}
                placeholder="Background, interests, context for Enzo AI…"
                value={form.about} onChange={(e) => set("about", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-style">
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="h-3 w-3" />
                  How should Enzo AI respond to you?
                </span>
              </Label>
              <textarea id="s-style" className={`${inputCls} resize-none`} rows={2}
                placeholder="e.g. Be concise, use code examples, skip the fluff."
                value={form.assistantStyle} onChange={(e) => set("assistantStyle", e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            {saved && <span className="text-xs text-ok">Saved ✓</span>}
            <button type="button" onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted hover:text-fg">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
        )}
        </div>
      </div>
    </div>
  );
}
