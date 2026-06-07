import { useEffect, useState } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight, Plug } from "lucide-react";
import { ModalHeader } from "./ui/ModalHeader";
import { api } from "../api";
import type { McpServer } from "../types";
import { ConnectorCard, ConnectorSectionLabel } from "./ui/ConnectorCard";

// ── Brand icons ───────────────────────────────────────────────────────────────

function ChromeIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="24" fill="#fff"/>
      <circle cx="24" cy="24" r="10" fill="#4285f4"/>
      <path d="M24 14h18.36A24 24 0 0 0 5.64 14z" fill="#ea4335"/>
      <path d="M5.64 14A24 24 0 0 0 14.6 40.58L23.46 24z" fill="#fbbc05"/>
      <path d="M14.6 40.58A24 24 0 0 0 42.36 14H24l-9.4 26.58z" fill="#34a853"/>
      <circle cx="24" cy="24" r="6" fill="#fff"/>
    </svg>
  );
}

function GitHubIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="text-fg">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}

function BraveIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path fill="#FB542B" d="M20.92 5.49L19.4 3.72a1.55 1.55 0 0 0-1.22-.59H5.82a1.55 1.55 0 0 0-1.22.59L3.08 5.49a2.3 2.3 0 0 0-.37 2.18l2.9 8.52a3.06 3.06 0 0 0 1.47 1.73l4.34 2.27a1.15 1.15 0 0 0 1.16 0l4.34-2.27a3.06 3.06 0 0 0 1.47-1.73l2.9-8.52a2.3 2.3 0 0 0-.37-2.18z"/>
      <path fill="#fff" d="M16.07 8.1l-.42-.44a.31.31 0 0 0-.44 0l-2.5 2.5-.71-.72 2.5-2.5a.31.31 0 0 0 0-.44l-.42-.44a.31.31 0 0 0-.44 0L12 8.72l-1.64-1.66a.31.31 0 0 0-.44 0l-.42.44a.31.31 0 0 0 0 .44l2.5 2.5-.71.72-2.5-2.5a.31.31 0 0 0-.44 0l-.42.44a.31.31 0 0 0 0 .44l1.89 1.9-1.08 3.26a1.38 1.38 0 0 0 .42 1.49l2.42 2.07a.57.57 0 0 0 .74 0l2.42-2.07a1.38 1.38 0 0 0 .42-1.49l-1.08-3.26 1.89-1.9a.31.31 0 0 0 0-.44z"/>
    </svg>
  );
}

function FilesystemIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <line x1="12" y1="11" x2="12" y2="17"/>
      <line x1="9" y1="14" x2="15" y2="14"/>
    </svg>
  );
}

function SlackMCPIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z"/>
      <path fill="#E01E5A" d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"/>
      <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z"/>
      <path fill="#36C5F0" d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"/>
      <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z"/>
      <path fill="#2EB67D" d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"/>
      <path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z"/>
      <path fill="#ECB22E" d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  );
}

function NotionIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="text-fg">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/>
    </svg>
  );
}

// ── Featured connector catalog ────────────────────────────────────────────────

interface FeaturedConnector {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  bgColor: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  envLabels?: Record<string, string>;
  envRequired?: string[];
}

const FEATURED: FeaturedConnector[] = [
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "Control a Chrome browser — navigate, screenshot, fill forms",
    icon: <ChromeIcon size={28} />,
    bgColor: "#fff",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
  },
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read and write files on your local machine",
    icon: <FilesystemIcon size={28} />,
    bgColor: "#1c1917",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/"],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Search repos, read files, manage issues and PRs",
    icon: <GitHubIcon size={28} />,
    bgColor: "#0d1117",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
    envLabels: { GITHUB_PERSONAL_ACCESS_TOKEN: "Personal Access Token" },
    envRequired: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Search the web with Brave's privacy-first index",
    icon: <BraveIcon size={28} />,
    bgColor: "#1c0a00",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: { BRAVE_API_KEY: "" },
    envLabels: { BRAVE_API_KEY: "Brave API Key" },
    envRequired: ["BRAVE_API_KEY"],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Read channels, send messages, search your workspace",
    icon: <SlackMCPIcon size={28} />,
    bgColor: "#1a1a2e",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" },
    envLabels: { SLACK_BOT_TOKEN: "Bot Token", SLACK_TEAM_ID: "Team ID" },
    envRequired: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search pages, read databases, create and update content",
    icon: <NotionIcon size={28} />,
    bgColor: "#191919",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-notion"],
    env: { NOTION_API_TOKEN: "" },
    envLabels: { NOTION_API_TOKEN: "Integration Token" },
    envRequired: ["NOTION_API_TOKEN"],
  },
];

const inputCls = "w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent placeholder:text-muted";

interface Props {
  onClose: () => void;
}

export function McpPanel({ onClose }: Props) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [view, setView] = useState<"grid" | "featured-detail" | "custom-form">("grid");
  const [selectedFeatured, setSelectedFeatured] = useState<FeaturedConnector | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [customForm, setCustomForm] = useState({ name: "", type: "stdio" as "stdio" | "http", command: "", args: "", url: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [connectResults, setConnectResults] = useState<Record<string, { toolCount: number } | "loading" | "error">>({});

  useEffect(() => {
    api.mcp.list().then(setServers).catch(() => {});
  }, []);

  function installedFor(feat: FeaturedConnector) {
    return servers.find(s => s.command === feat.command && JSON.stringify(s.args.slice(0, 2)) === JSON.stringify(feat.args.slice(0, 2)));
  }

  async function installFeatured() {
    if (!selectedFeatured) return;
    setBusy(true); setErr(null);
    try {
      const server = await api.mcp.create({
        name: selectedFeatured.name,
        type: "stdio",
        command: selectedFeatured.command,
        args: selectedFeatured.args,
        env: envValues,
      });
      setServers(prev => [...prev, server]);
      setView("grid");
      setSelectedFeatured(null);
      setEnvValues({});
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  async function saveCustom() {
    if (!customForm.name.trim()) { setErr("Name is required"); return; }
    if (customForm.type === "stdio" && !customForm.command.trim()) { setErr("Command is required"); return; }
    if (customForm.type === "http" && !customForm.url.trim()) { setErr("URL is required"); return; }
    setBusy(true); setErr(null);
    try {
      const args = customForm.args.trim() ? customForm.args.split(/\s+/).filter(Boolean) : [];
      const server = await api.mcp.create({
        name: customForm.name.trim(),
        type: customForm.type,
        command: customForm.type === "stdio" ? customForm.command.trim() : undefined,
        args,
        url: customForm.type === "http" ? customForm.url.trim() : undefined,
      });
      setServers(prev => [...prev, server]);
      setView("grid");
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  async function toggleEnabled(server: McpServer) {
    const updated = await api.mcp.update(server.id, { enabled: !server.enabled });
    setServers(prev => prev.map(s => s.id === updated.id ? updated : s));
  }

  async function remove(id: string) {
    if (!confirm("Remove this connector?")) return;
    await api.mcp.delete(id).catch(() => {});
    setServers(prev => prev.filter(s => s.id !== id));
  }

  async function testConnect(id: string) {
    setConnectResults(r => ({ ...r, [id]: "loading" }));
    try {
      const result = await api.mcp.connect(id);
      setConnectResults(r => ({ ...r, [id]: result }));
    } catch {
      setConnectResults(r => ({ ...r, [id]: "error" }));
    }
  }

  // ── Featured detail view ────────────────────────────────────────────────────
  if (view === "featured-detail" && selectedFeatured) {
    const hasEnv = selectedFeatured.envRequired && selectedFeatured.envRequired.length > 0;
    const envFilled = !hasEnv || (selectedFeatured.envRequired ?? []).every(k => envValues[k]?.trim());
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4">
        <div className="flex h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
          <ModalHeader
            title={selectedFeatured.name}
            onBack={() => { setView("grid"); setErr(null); }}
            backLabel="All servers"
            onClose={onClose}
          />

          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
            {/* Icon + name */}
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border border-border" style={{ background: selectedFeatured.bgColor }}>
                {selectedFeatured.icon}
              </div>
              <div>
                <h2 className="text-lg font-bold">{selectedFeatured.name}</h2>
                <p className="text-sm text-muted">{selectedFeatured.description}</p>
              </div>
            </div>

            {/* Command preview */}
            <div className="rounded-xl border border-border bg-surface-2 px-4 py-3 font-mono text-xs text-muted">
              {selectedFeatured.command} {selectedFeatured.args.join(" ")}
            </div>

            {/* Env fields */}
            {hasEnv && (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-semibold text-muted">Required credentials</p>
                {(selectedFeatured.envRequired ?? []).map(key => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label className="text-xs text-muted">{selectedFeatured.envLabels?.[key] ?? key}</label>
                    <input
                      className={inputCls}
                      type="password"
                      placeholder={`Enter ${selectedFeatured.envLabels?.[key] ?? key}`}
                      value={envValues[key] ?? ""}
                      onChange={e => setEnvValues(v => ({ ...v, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            )}

            {err && <p className="text-xs text-danger">{err}</p>}
          </div>

          <div className="border-t border-border px-5 py-4">
            <button
              onClick={installFeatured}
              disabled={busy || !envFilled}
              className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40"
            >
              {busy ? "Adding…" : "Add connector"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Custom form view ─────────────────────────────────────────────────────────
  if (view === "custom-form") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4">
        <div className="flex h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
          <ModalHeader
            title="Custom connector"
            onBack={() => { setView("grid"); setErr(null); }}
            backLabel="All servers"
            onClose={onClose}
          />

          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
            {err && <p className="text-xs text-danger">{err}</p>}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted">Name</label>
              <input className={inputCls} placeholder="My MCP server" autoFocus
                value={customForm.name} onChange={e => setCustomForm(f => ({ ...f, name: e.target.value }))} />
            </div>

            <div className="flex gap-2">
              {(["stdio", "http"] as const).map(t => (
                <button key={t} onClick={() => setCustomForm(f => ({ ...f, type: t }))}
                  className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${customForm.type === t ? "border-accent bg-accent/10 text-accent-2" : "border-border text-muted hover:border-accent/40"}`}>
                  {t === "stdio" ? "Local process" : "HTTP / SSE"}
                </button>
              ))}
            </div>

            {customForm.type === "stdio" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted">Command</label>
                  <input className={inputCls} placeholder="npx"
                    value={customForm.command} onChange={e => setCustomForm(f => ({ ...f, command: e.target.value }))} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted">Arguments <span className="font-normal text-muted/70">(space-separated)</span></label>
                  <input className={inputCls} placeholder="-y @modelcontextprotocol/server-puppeteer"
                    value={customForm.args} onChange={e => setCustomForm(f => ({ ...f, args: e.target.value }))} />
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted">Server URL</label>
                <input className={inputCls} placeholder="http://localhost:3100/sse"
                  value={customForm.url} onChange={e => setCustomForm(f => ({ ...f, url: e.target.value }))} />
              </div>
            )}
          </div>

          <div className="border-t border-border px-5 py-4">
            <button onClick={saveCustom} disabled={busy}
              className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent-2 disabled:opacity-40">
              {busy ? "Adding…" : "Add connector"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main grid view ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm p-4">
      <div className="flex h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">

        {/* Header */}
        <ModalHeader
          title="MCP Servers"
          subtitle="Extend your agents with tools from MCP servers"
          onClose={onClose}
        />

        <div className="flex-1 overflow-y-auto">

          {/* Installed connectors */}
          {servers.length > 0 && (
            <div className="px-5 pt-5 pb-2">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted/60">Installed</p>
              <div className="flex flex-col gap-2">
                {servers.map(server => {
                  const feat = FEATURED.find(f => installedFor(f)?.id === server.id);
                  const result = connectResults[server.id];
                  return (
                    <div key={server.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border overflow-hidden" style={{ background: feat?.bgColor ?? "#1a1a2e" }}>
                        {feat ? feat.icon : <Plug className="h-4 w-4 text-muted" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{server.name}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${server.enabled ? "text-ok border-ok/30 bg-ok/10" : "text-muted border-border bg-surface"}`}>
                            {server.enabled ? "Active" : "Disabled"}
                          </span>
                          {result && result !== "loading" && result !== "error" && (
                            <span className="text-[10px] text-muted">{(result as any).toolCount} tools</span>
                          )}
                        </div>
                        <p className="text-xs text-muted font-mono truncate mt-0.5">
                          {server.type === "stdio" ? `${server.command} ${server.args.join(" ")}`.trim() : server.url}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => testConnect(server.id)} disabled={result === "loading"}
                          className="text-[11px] text-muted hover:text-accent-2 transition-colors px-2">
                          {result === "loading" ? "…" : "Test"}
                        </button>
                        <button onClick={() => toggleEnabled(server)} title={server.enabled ? "Disable" : "Enable"}
                          className="text-muted hover:text-fg transition-colors">
                          {server.enabled ? <ToggleRight className="h-5 w-5 text-ok" /> : <ToggleLeft className="h-5 w-5" />}
                        </button>
                        <button onClick={() => remove(server.id)}
                          className="rounded-md p-1 text-muted hover:text-danger transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Featured catalog */}
          <div className="px-5 pt-5 pb-5">
            <ConnectorSectionLabel>Available</ConnectorSectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {FEATURED.map(feat => {
                const installed = installedFor(feat);
                return (
                  <ConnectorCard
                    key={feat.id}
                    icon={feat.icon}
                    iconBg={feat.bgColor}
                    name={feat.name}
                    description={feat.description}
                    added={!!installed}
                    onClick={installed ? undefined : () => {
                      setSelectedFeatured(feat);
                      setEnvValues(Object.fromEntries(Object.keys(feat.env ?? {}).map(k => [k, ""])));
                      setErr(null);
                      setView("featured-detail");
                    }}
                  />
                );
              })}

              {/* Custom connector card */}
              <button
                onClick={() => { setCustomForm({ name: "", type: "stdio", command: "", args: "", url: "" }); setErr(null); setView("custom-form"); }}
                className="group flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3.5 text-left transition-all hover:border-accent/40 hover:bg-surface"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-dashed border-border">
                  <Plus className="h-4 w-4 text-muted" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-muted group-hover:text-fg transition-colors">Custom</p>
                  <p className="text-[11px] text-muted/60">Any stdio or HTTP server</p>
                </div>
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
