import { useEffect, useState } from "react";
import { useConfirm } from "./ui/ConfirmProvider";
import { Pencil, Trash2, Play, Clock, Zap, Globe, Calculator, Calendar, ChevronDown, ChevronRight, GitBranch, Key, ShieldAlert, Send, Mail } from "lucide-react";
import { SiTelegram, SiDiscord } from "react-icons/si";
import { SlackIcon } from "./ui/SlackIcon";
import { Plus, X } from "lucide-react";

// ── Schedule builder ──────────────────────────────────────────────────────────

type Freq = "hourly" | "daily" | "weekly" | "monthly";

interface ScheduleState {
  freq: Freq;
  minute: number;   // 0–59
  hour: number;     // 0–23
  days: number[];   // 0=Sun … 6=Sat (weekly)
  dayOfMonth: number; // 1–31 (monthly)
}

const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function toCron(s: ScheduleState): string {
  switch (s.freq) {
    case "hourly":  return `0 * * * *`;
    case "daily":   return `${s.minute} ${s.hour} * * *`;
    case "weekly":  return `${s.minute} ${s.hour} * * ${s.days.length ? s.days.sort().join(",") : "*"}`;
    case "monthly": return `${s.minute} ${s.hour} ${s.dayOfMonth} * *`;
  }
}

function defaultSchedule(): ScheduleState {
  return { freq: "daily", minute: 0, hour: 9, days: [1], dayOfMonth: 1 };
}

function ScheduleBuilder({ value, onChange }: { value: ScheduleState; onChange: (s: ScheduleState) => void }) {
  const set = (patch: Partial<ScheduleState>) => onChange({ ...value, ...patch });
  const LABEL: Record<Freq, string> = { hourly:"Every hour", daily:"Every day", weekly:"Every week", monthly:"Every month" };

  return (
    <div className="flex flex-col gap-4">
      {/* Frequency pills */}
      <div className="flex gap-2 flex-wrap">
        {(["hourly","daily","weekly","monthly"] as Freq[]).map(f => (
          <button key={f} type="button" onClick={() => set({ freq: f })}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              value.freq === f ? "border-accent bg-accent/10 text-accent-2" : "border-border text-muted hover:border-accent/40 hover:text-fg"
            }`}>
            {LABEL[f]}
          </button>
        ))}
      </div>

      {/* Weekly — days */}
      {value.freq === "weekly" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">On</label>
          <div className="flex gap-1.5">
            {DAYS_SHORT.map((d,i) => (
              <button key={d} type="button"
                onClick={() => set({ days: value.days.includes(i) ? value.days.filter(x=>x!==i) : [...value.days,i] })}
                className={`h-8 w-10 rounded-lg border text-xs font-semibold transition-colors ${
                  value.days.includes(i) ? "border-accent bg-accent/10 text-accent-2" : "border-border text-muted hover:border-accent/40"
                }`}>
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Monthly — day of month */}
      {value.freq === "monthly" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-muted">On day</label>
          <div className="flex flex-wrap gap-1">
            {Array.from({length:31},(_,i)=>i+1).map(d => (
              <button key={d} type="button" onClick={() => set({ dayOfMonth: d })}
                className={`h-7 w-7 rounded-lg border text-xs font-semibold transition-colors ${
                  value.dayOfMonth === d ? "border-accent bg-accent/10 text-accent-2" : "border-border text-muted hover:border-accent/40"
                }`}>
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hour + Minute — hidden for "every hour" */}
      {value.freq !== "hourly" && (
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted">At hour</label>
            <Select value={String(value.hour)} onValueChange={v => set({ hour: Number(v) })}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({length:24},(_,i)=>i).map(h => (
                  <SelectItem key={h} value={String(h)}>{h}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted">Minute</label>
            <Select value={String(value.minute)} onValueChange={v => set({ minute: Number(v) })}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({length:60},(_,i)=>i).map(m => (
                  <SelectItem key={m} value={String(m)}>{String(m).padStart(2,"0")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}

function describeSchedule(s: ScheduleState): string {
  const time = `at ${String(s.hour).padStart(2,"0")}:${String(s.minute).padStart(2,"0")}`;
  switch (s.freq) {
    case "hourly":  return "every hour";
    case "daily":   return `every day ${time}`;
    case "weekly": {
      const dayNames = s.days.sort().map(d => DAYS_SHORT[d]).join(", ");
      return `every ${dayNames || "…"} ${time}`;
    }
    case "monthly": return `on the ${ordinal(s.dayOfMonth)} of every month ${time}`;
  }
}

function ordinal(n: number) {
  const s = ["th","st","nd","rd"], v = n % 100;
  return n + (s[(v-20)%10] ?? s[v] ?? s[0]);
}
import { api } from "../api";
import type { Agent, ModelInfo, ToolDefinition, ToolName } from "../types";
import { ModelPicker } from "./ui/ModelPicker";
import { ModalHeader } from "./ui/ModalHeader";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "./ui/Select";

const inputCls = "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent placeholder:text-muted";

// Partial: list_directory/read_file are auto-injected per-chat tools, never
// shown in this picker (see FOLDER_TOOL_DEFINITIONS in tools.service.ts).
const TOOL_ICONS: Partial<Record<ToolName, React.ReactNode>> = {
  get_datetime:    <Clock className="h-3.5 w-3.5" />,
  calculator:      <Calculator className="h-3.5 w-3.5" />,
  web_search:      <Globe className="h-3.5 w-3.5" />,
  read_url:        <Zap className="h-3.5 w-3.5" />,
  git:             <GitBranch className="h-3.5 w-3.5" />,
  api_request:     <Key className="h-3.5 w-3.5" />,
  calendar:        <Calendar className="h-3.5 w-3.5" />,
  search_emails:   <Mail className="h-3.5 w-3.5" />,
  read_email:      <Mail className="h-3.5 w-3.5" />,
};

const EMOJI_OPTIONS = [
  "🤖","🔧","⏰","🧠","💡","📊","🔍","💻","📝","🎯",
  "🚀","⚡","🌐","📚","🔬","💬","🛡️","⚙️","🎨","📈",
  "🦾","🕵️","📡","🤝","🧬","🔑","🏗️","🎙️","📌","✨",
];


/** Look up whether a model supports tool/function calling from the real model list. */
function modelSupportsTools(modelId: string, models: ModelInfo[]): boolean {
  if (!modelId) return true; // system default — assume yes, show tools
  const found = models.find(m => m.id === modelId);
  // If model is in the list, trust its flag; if not found default to showing tools
  return found ? (found.supportsTools ?? true) : true;
}

// ── Integration entry selector ────────────────────────────────────────────────

type IntegrationType = "telegram" | "discord" | "slack";

interface IntegrationEntry {
  type: IntegrationType;
  chatId: string;
  /** True for entries already saved on the agent — their type can't be changed,
   *  since it's fixed to whatever chat/channel the ID actually points at. */
  locked?: boolean;
}

const ALL_INTEGRATION_OPTIONS: { type: IntegrationType; label: string; icon: React.ReactNode; color: string; placeholder: string }[] = [
  { type: "telegram", label: "Telegram", icon: <SiTelegram className="h-3.5 w-3.5" />, color: "text-[#2AABEE]", placeholder: "Chat ID — send /chatid to get it" },
  { type: "discord",  label: "Discord",  icon: <SiDiscord  className="h-3.5 w-3.5" />, color: "text-[#5865F2]", placeholder: "Channel ID — right-click channel → Copy Channel ID" },
  { type: "slack",    label: "Slack",    icon: <SlackIcon  className="h-3.5 w-3.5" />, color: "",              placeholder: "Channel ID — right-click channel name → Copy link, use ID from URL" },
];

/** Parses comma-separated chatIds string into entries (type unknown, assume telegram for existing data) */
function parseEntries(chatIds: string): IntegrationEntry[] {
  return chatIds.split(",").map(s => s.trim()).filter(Boolean)
    .map(chatId => ({ type: "telegram" as IntegrationType, chatId, locked: true }));
}

/** Serialises entries back to comma-separated string (all IDs, regardless of type) */
function serialiseEntries(entries: IntegrationEntry[]): string {
  return entries.filter(e => e.chatId.trim()).map(e => e.chatId.trim()).join(",");
}

/** Collapsible, same visual pattern as the "Scheduled run" section — defaults
 *  open only if this agent already has integrations configured. */
function IntegrationEntries({ value, onChange, availableOptions }: {
  value: string;
  onChange: (v: string) => void;
  availableOptions: typeof ALL_INTEGRATION_OPTIONS;
}) {
  const [entries, setEntries] = useState<IntegrationEntry[]>(() => parseEntries(value));
  const [open, setOpen] = useState(() => parseEntries(value).length > 0);

  function update(next: IntegrationEntry[]) {
    setEntries(next);
    onChange(serialiseEntries(next));
  }

  function addEntry() {
    const firstType = availableOptions[0]?.type ?? "telegram";
    update([...entries, { type: firstType, chatId: "" }]);
  }

  function removeEntry(i: number) {
    update(entries.filter((_, idx) => idx !== i));
  }

  function setEntry(i: number, patch: Partial<IntegrationEntry>) {
    update(entries.map((e, idx) => idx === i ? { ...e, ...patch } : e));
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden flex-shrink-0">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-2 transition-colors">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-muted" />
          <span className="text-sm font-semibold">Integrations</span>
          {entries.length > 0 && (
            <span className="text-[10px] text-ok font-semibold">
              {entries.length} connected
            </span>
          )}
        </div>
        {open
          ? <ChevronDown className="h-4 w-4 text-muted" />
          : <ChevronRight className="h-4 w-4 text-muted" />}
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-4 flex flex-col gap-2 bg-surface-2/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">Send scheduled results to a connected chat or channel.</span>
            {availableOptions.length > 0 && (
              <button
                type="button"
                onClick={addEntry}
                className="flex flex-shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/60 hover:text-fg"
              >
                <Plus className="h-3 w-3" /> Add
              </button>
            )}
          </div>

          {availableOptions.length === 0 && (
            <p className="text-[11px] text-muted">
              No integrations connected. Set up Telegram or Discord in Admin Panel → Integrations.
            </p>
          )}

          {entries.length > 0 && (
            <div className="flex items-center gap-1.5 px-0.5">
              <span className="w-36 flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">Type</span>
              <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Chat / Channel ID</span>
              <span className="w-4 flex-shrink-0" />
            </div>
          )}

          {entries.map((entry, i) => {
            const opt = availableOptions.find(o => o.type === entry.type) ?? availableOptions[0];
            return (
              <div key={i} className="flex items-center gap-1.5">
                {entry.locked ? (
                  <div className="flex h-9 w-36 flex-shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-sm text-fg">
                    <span className={`flex items-center gap-1.5 ${opt?.color}`}>{opt?.icon}<span>{opt?.label}</span></span>
                  </div>
                ) : (
                  <Select value={entry.type} onValueChange={v => setEntry(i, { type: v as IntegrationType, chatId: "" })}>
                    <SelectTrigger className="w-36 flex-shrink-0 px-2.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableOptions.map(o => (
                        <SelectItem key={o.type} value={o.type}>
                          <span className={`flex items-center gap-1.5 ${o.color}`}>{o.icon}<span>{o.label}</span></span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <input
                  className={`${inputCls} flex-1`}
                  placeholder={opt?.placeholder ?? "Chat ID"}
                  value={entry.chatId}
                  onChange={e => setEntry(i, { chatId: e.target.value })}
                />

                <button type="button" onClick={() => removeEntry(i)} className="flex-shrink-0 text-muted hover:text-danger transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Agent credentials (API keys/tokens scoped to this agent) ─────────────────

interface AgentCredential { id: string; name: string; createdAt: number }

/** Named secrets for this agent (e.g. a trading platform API key), used by the
 *  api_request tool. Values are vault-encrypted server-side and never sent
 *  back to the browser once saved — only name/createdAt. */
function AgentCredentialsSection({ agentId }: { agentId: string }) {
  const confirm = useConfirm();
  const [credentials, setCredentials] = useState<AgentCredential[]>([]);
  const [vaultStatus, setVaultStatus] = useState<{ configured: boolean; unlocked: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.agents.listCredentials(agentId).then(setCredentials).catch(() => {});
    api.vault.status().then(setVaultStatus).catch(() => {});
  }, [agentId]);

  async function add() {
    if (!name.trim() || !value.trim()) { setErr("Name and value are required."); return; }
    setBusy(true); setErr(null);
    try {
      const created = await api.agents.addCredential(agentId, { name: name.trim(), value: value.trim() });
      setCredentials((prev) => [created, ...prev]);
      setName(""); setValue("");
      setAdding(false);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  async function remove(id: string, credName: string) {
    if (!(await confirm({ title: `Remove "${credName}"?`, description: "Any tool calls using this credential will stop working.", confirmText: "Remove", danger: true }))) return;
    await api.agents.removeCredential(agentId, id).catch(() => {});
    setCredentials((prev) => prev.filter((c) => c.id !== id));
  }

  const vaultReady = vaultStatus?.configured ?? true; // don't block the UI before the status check resolves

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-semibold text-muted">
        Credentials <span className="font-normal">(optional — API keys for the api_request tool)</span>
      </label>

      {vaultStatus && !vaultStatus.configured && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>Set up encryption in Settings → Vault before adding credentials — they're too sensitive to store unencrypted.</span>
        </div>
      )}

      {credentials.map((c) => (
        <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <Key className="h-3.5 w-3.5 flex-shrink-0 text-muted" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-fg">{c.name}</p>
          </div>
          <button type="button" onClick={() => remove(c.id, c.name)} className="flex-shrink-0 text-muted hover:text-danger" title="Remove credential">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2 p-3">
          <label className="text-[11px] font-semibold text-muted">Name</label>
          <input className={inputCls} placeholder="e.g. alpaca_trading" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="mt-1 text-[11px] font-semibold text-muted">Value</label>
          <input className={inputCls} type="password" placeholder="The API key / token" value={value} onChange={(e) => setValue(e.target.value)} />

          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="mt-1 flex gap-2">
            <button type="button" onClick={() => { setAdding(false); setErr(null); }} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-fg">
              Cancel
            </button>
            <button type="button" onClick={add} disabled={busy} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
              {busy ? "Adding…" : "Add credential"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={!vaultReady}
          title={vaultReady ? undefined : "Set up encryption first (Settings → Vault)"}
          className="flex items-center gap-1 self-start rounded-lg border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/60 hover:text-fg disabled:opacity-40"
        >
          <Plus className="h-3 w-3" /> Add credential
        </button>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  onStartChat: (agentId: string) => void;
  onClose: () => void;
}

export function AgentsPanel({ onStartChat, onClose }: Props) {
  const confirm = useConfirm();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<{ id: string; name: string }[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [defaultModelId, setDefaultModelId] = useState<string>("");
  const [connectedIntegrations, setConnectedIntegrations] = useState<typeof ALL_INTEGRATION_OPTIONS>([]);
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<Agent | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleState, setScheduleState] = useState<ScheduleState>(defaultSchedule());
  const [form, setForm] = useState({
    name: "", emoji: "🤖", description: "", instructions: "",
    model: "",
    tools: [] as ToolName[],
    knowledgeBaseId: "",
    schedulePrompt: "", scheduleEnabled: false, telegramChatIds: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.agents.list().then(setAgents).catch(() => {});
    api.agents.tools().then(setTools).catch(() => {});
    api.knowledge.listBases().then((bs) => setKnowledgeBases(bs.map((b) => ({ id: b.id, name: b.name })))).catch(() => {});
    api.models().then(({ models, default: def }) => {
      setAvailableModels(models);
      setDefaultModelId(def);
    }).catch(() => {});
    api.integrations().then(({ telegram, discord, slack }) => {
      setConnectedIntegrations(ALL_INTEGRATION_OPTIONS.filter(o =>
        (o.type === "telegram" && telegram) ||
        (o.type === "discord"  && discord)  ||
        (o.type === "slack"    && slack)
      ));
    }).catch(() => {});
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", emoji: "🤖", description: "", instructions: "",
               model: "", tools: [], knowledgeBaseId: "", schedulePrompt: "", scheduleEnabled: false, telegramChatIds: "" });
    setScheduleState(defaultSchedule());
    setScheduleOpen(false);
    setEmojiOpen(false);
    setErr(null);
    setView("form");
  }

  function openEdit(agent: Agent) {
    setEditing(agent);
    setForm({
      name: agent.name, emoji: agent.emoji, description: agent.description ?? "",
      instructions: agent.instructions, model: agent.model ?? "",
      tools: agent.tools,
      knowledgeBaseId: agent.knowledgeBaseId ?? "",
      schedulePrompt: agent.schedulePrompt ?? "",
      scheduleEnabled: agent.scheduleEnabled,
      telegramChatIds: agent.telegramChatIds ?? "",
    });
    setScheduleState(defaultSchedule()); // could parse existing cron, for now reset
    setScheduleOpen(!!(agent.schedule));
    setEmojiOpen(false);
    setErr(null);
    setView("form");
  }

  async function save() {
    if (!form.name.trim() || !form.instructions.trim()) {
      setErr("Name and instructions are required");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const payload = {
        name: form.name.trim(), emoji: form.emoji,
        description: form.description.trim() || undefined,
        instructions: form.instructions.trim(),
        model: form.model || undefined,
        tools: form.tools,
        knowledgeBaseId: form.knowledgeBaseId || null,
        schedule: scheduleOpen ? toCron(scheduleState) : undefined,
        schedulePrompt: scheduleOpen && form.schedulePrompt.trim() ? form.schedulePrompt.trim() : undefined,
        scheduleEnabled: scheduleOpen ? form.scheduleEnabled : false,
        telegramChatIds: form.telegramChatIds.trim() || undefined,
      };
      let saved: Agent;
      if (editing) {
        saved = await api.agents.update(editing.id, payload as any);
        setAgents(prev => prev.map(a => a.id === saved.id ? saved : a));
      } else {
        saved = await api.agents.create(payload as any);
        setAgents(prev => [saved, ...prev]);
      }
      setView("list");
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  async function remove(id: string) {
    if (!(await confirm({ title: "Delete agent?", description: "This agent will be permanently deleted.", confirmText: "Delete", danger: true }))) return;
    await api.agents.delete(id).catch(() => {});
    setAgents(prev => prev.filter(a => a.id !== id));
  }

  function toggleTool(t: ToolName) {
    setForm(f => ({ ...f, tools: f.tools.includes(t) ? f.tools.filter(x => x !== t) : [...f.tools, t] }));
  }

  const showTools = modelSupportsTools(form.model, availableModels);

  // ── List view ──────────────────────────────────────────────────────────────
  if (view === "list") return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4">
      <div className="flex h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <ModalHeader
          title="Agents"
          subtitle="AI assistants configured for specific tasks"
          onClose={onClose}
          actions={
            agents.length > 0 ? (
              <button onClick={openCreate}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-2">
                + New agent
              </button>
            ) : undefined
          }
        />

        <div className="flex-1 overflow-y-auto p-5">
          {agents.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <div className="text-4xl opacity-30">🤖</div>
              <div>
                <p className="font-semibold text-fg">No agents yet</p>
                <p className="text-sm text-muted">Create an agent to configure a custom AI assistant</p>
              </div>
              <button onClick={openCreate}
                className="rounded-xl bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:bg-accent-2">
                Create your first agent
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {agents.map(a => (
                <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
                  <span className="text-2xl">{a.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-fg">{a.name}</span>
                      {a.model && <span className="text-[10px] text-muted border border-border rounded px-1.5 py-0.5">{a.model.split(":").pop()}</span>}
                      {a.tools.length > 0 && <span className="text-[10px] text-accent-2 font-semibold">🔧 {a.tools.length} tool{a.tools.length > 1 ? "s" : ""}</span>}
                      {a.schedule && <span className="text-[10px] text-amber-400 font-semibold">⏰ {a.schedule}</span>}
                    </div>
                    <p className="text-xs text-muted truncate mt-0.5">{a.description || a.instructions.slice(0, 80)}</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => { onStartChat(a.id); onClose(); }}
                      className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-accent-2">
                      <Play className="h-3 w-3" /> Chat
                    </button>
                    <button onClick={() => openEdit(a)} className="rounded-lg border border-border p-1.5 text-muted hover:text-fg">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => remove(a.id)} className="rounded-lg border border-border p-1.5 text-muted hover:text-danger">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ── Create / Edit form ─────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4">
      <div className="flex h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <ModalHeader
          title={editing ? `Edit — ${editing.name}` : "New agent"}
          onBack={() => setView("list")}
          backLabel="All agents"
          onClose={onClose}
        />

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {err && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{err}</div>}

          {/* Name + emoji */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted">Name</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEmojiOpen(v => !v)}
                className={`flex h-[38px] w-[46px] flex-shrink-0 items-center justify-center rounded-lg border text-xl transition-colors ${emojiOpen ? "border-accent bg-accent/10" : "border-border bg-surface-2 hover:border-accent/50"}`}
                title="Choose icon">
                {form.emoji}
              </button>
              <input className={`${inputCls} flex-1`} placeholder="e.g. Research Assistant" autoFocus
                value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                onFocus={() => setEmojiOpen(false)} />
            </div>
            {emojiOpen && (
              <div className="grid grid-cols-10 gap-0.5 rounded-xl border border-border bg-surface-2 p-2">
                {EMOJI_OPTIONS.map(e => (
                  <button key={e} type="button"
                    onClick={() => { setForm(f => ({...f, emoji: e})); setEmojiOpen(false); }}
                    className={`flex h-8 w-full items-center justify-center rounded-lg text-lg transition-colors hover:bg-surface ${form.emoji === e ? "bg-accent/20 ring-1 ring-accent" : ""}`}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted">Description <span className="font-normal">(optional)</span></label>
            <input className={inputCls} placeholder="What this agent does"
              value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} />
          </div>

          {/* Instructions */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted">Instructions</label>
            <textarea className={`${inputCls} resize-none`} rows={4}
              placeholder="Tell the agent how to behave, what to focus on, and how to respond…"
              value={form.instructions} onChange={e => setForm(f => ({...f, instructions: e.target.value}))} />
          </div>

          {/* Model */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-muted">Model</label>
            <ModelPicker
              value={form.model}
              onChange={(v) => setForm(f => ({ ...f, model: v, tools: [] }))}
              models={availableModels}
              defaultModelId={defaultModelId}
            />
          </div>

          {/* Knowledge base — answers grounded in attached documents (RAG) */}
          {knowledgeBases.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted">Knowledge base <span className="font-normal">(optional)</span></label>
              <Select value={form.knowledgeBaseId || "none"} onValueChange={(v) => setForm(f => ({ ...f, knowledgeBaseId: v === "none" ? "" : v }))}>
                <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {knowledgeBases.map(kb => <SelectItem key={kb.id} value={kb.id}>{kb.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted">When set, the agent retrieves relevant document passages to ground its answers.</p>
            </div>
          )}

          {/* Tools — only shown when model supports it. Lists only available
              tools (admin-enabled and, where required, with the account
              connected); a tool already selected on this agent stays visible
              even if it later becomes unavailable, so it can be deselected. */}
          {(() => {
            if (!showTools) return null;
            const visibleTools = tools.filter((t) => {
              const available = t.enabled && (t.connected ?? true);
              return available || form.tools.includes(t.name as ToolName);
            });
            if (visibleTools.length === 0) return null;
            return (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-muted">
                Tools
                {!form.model && <span className="ml-1 font-normal">(available when model supports function calling)</span>}
              </label>
              <div className="flex flex-wrap gap-2">
                {visibleTools.map(t => {
                  const isSelected = form.tools.includes(t.name as ToolName);
                  const isAvailable = t.enabled && (t.connected ?? true);
                  const unavailableReason = !t.enabled
                    ? "Disabled by administrator"
                    : t.requiresConnection
                      ? `Needs the ${t.requiresConnection} account connected`
                      : "Unavailable";
                  return (
                    <button key={t.name} type="button"
                      title={isAvailable ? t.description : unavailableReason}
                      onClick={() => toggleTool(t.name as ToolName)}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        !isAvailable
                          ? "border-warning/40 bg-warning/5 text-warning"
                          : isSelected
                            ? "border-accent bg-accent/10 text-accent-2"
                            : "border-border bg-surface-2 text-muted hover:border-accent/40 hover:text-fg"
                      }`}>
                      {TOOL_ICONS[t.name as ToolName]}
                      {t.name.replace(/_/g, " ")}
                      {!isAvailable && <span className="text-[10px]">⚠</span>}
                    </button>
                  );
                })}
              </div>
              {form.tools.length > 0 && (
                <p className="text-[11px] text-muted">Selected tools will be available to the agent during chats.</p>
              )}
            </div>
            );
          })()}

          {/* Credentials — only for an already-saved agent, since a new one has no id yet. */}
          {editing && <AgentCredentialsSection agentId={editing.id} />}

          {/* Schedule — collapsible. flex-shrink-0 is required: overflow-hidden
              makes a flex item's automatic min-height resolve to 0 (per the
              flexbox spec), so under a short viewport this would get crushed
              to a sliver by its siblings instead of deferring to the parent's
              own overflow-y-auto scrolling. */}
          <div className="rounded-xl border border-border overflow-hidden flex-shrink-0">
            <button type="button" onClick={() => setScheduleOpen(v => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-surface-2 transition-colors">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted" />
                <span className="text-sm font-semibold">Scheduled run</span>
                {scheduleOpen && (
                  <span className="text-[10px] text-amber-400 font-semibold">{describeSchedule(scheduleState)}</span>
                )}
              </div>
              {scheduleOpen
                ? <ChevronDown className="h-4 w-4 text-muted" />
                : <ChevronRight className="h-4 w-4 text-muted" />}
            </button>

            {scheduleOpen && (
              <div className="border-t border-border px-4 pb-4 pt-4 flex flex-col gap-4 bg-surface-2/40">
                <ScheduleBuilder value={scheduleState} onChange={setScheduleState} />

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted">Prompt to run</label>
                  <textarea className={`${inputCls} resize-none`} rows={2}
                    placeholder="What should the agent do each time it runs?"
                    value={form.schedulePrompt} onChange={e => setForm(f => ({...f, schedulePrompt: e.target.value}))} />
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.scheduleEnabled}
                    onChange={e => setForm(f => ({...f, scheduleEnabled: e.target.checked}))}
                    className="h-4 w-4 rounded accent-accent" />
                  <span className="text-sm font-medium">Enable this schedule</span>
                </label>
              </div>
            )}
          </div>

          {/* Integrations — collapsible, same pattern as Schedule above. */}
          <IntegrationEntries
            value={form.telegramChatIds}
            onChange={v => setForm(f => ({...f, telegramChatIds: v}))}
            availableOptions={connectedIntegrations}
          />
        </div>

        <div className="border-t border-border px-5 py-4 flex gap-3">
          <button onClick={() => setView("list")} className="rounded-xl border border-border px-4 py-2 text-sm text-muted hover:text-fg">Cancel</button>
          <button onClick={save} disabled={busy || !form.name.trim() || !form.instructions.trim()}
            className="flex-1 rounded-xl bg-accent py-2 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
            {busy ? "Saving…" : editing ? "Save changes" : "Create agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
