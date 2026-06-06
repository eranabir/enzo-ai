import { useRef, useState, useEffect } from "react";
import { Settings, Shield, LogOut, ChevronUp, PanelLeftClose, PanelLeftOpen, Users, MoreHorizontal, Pencil, Trash2, MessagesSquare, SquarePen, Bot, Server } from "lucide-react";
import { SiTelegram, SiDiscord } from "react-icons/si";
import { SlackIcon } from "./ui/SlackIcon";
import type { Conversation, User } from "../types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";
import { SettingsPanel } from "./SettingsPanel";


// ── Animated "New" button ────────────────────────────────────────────────────

const NEW_BTN_CSS = `
  @keyframes nz-spin { to { transform: rotate(360deg); } }
  @keyframes nz-shimmer {
    0%   { transform: translateX(-200%) skewX(-15deg); }
    100% { transform: translateX(400%)  skewX(-15deg); }
  }
  @keyframes nz-star {
    0%,100% { opacity:.3; transform:scale(.9) rotate(-8deg); }
    50%     { opacity:.9; transform:scale(1.15) rotate(8deg); }
  }
  @keyframes nz-glow {
    0%,100% { box-shadow:0 0 12px 1px rgba(109,94,252,.4),0 0 24px 3px rgba(109,94,252,.1); }
    50%     { box-shadow:0 0 20px 3px rgba(109,94,252,.6),0 0 40px 6px rgba(167,139,250,.2),0 0 56px 8px rgba(56,189,248,.08); }
  }
  @keyframes nz-glow-sm {
    0%,100% { box-shadow:0 0 8px 1px rgba(109,94,252,.45); }
    50%     { box-shadow:0 0 16px 2px rgba(109,94,252,.65),0 0 28px 4px rgba(167,139,250,.2); }
  }

  /* Default state — no animations running */
  .nz-btn    { border-radius: 12px; }
  .nz-btn-sm { border-radius: 12px; }
  .nz-shimmer { transform: translateX(-200%) skewX(-15deg); } /* parked off-screen */
  .nz-star    { opacity: 0.35; }

  /* Hover — animations start fresh from frame 0 every time */
  .nz-btn:hover              { animation: nz-glow    4s ease-in-out infinite; }
  .nz-btn:hover .nz-spin     { animation: nz-spin    8s linear      infinite; }
  .nz-btn:hover .nz-shimmer  { animation: nz-shimmer 5s ease-in-out infinite 1.5s; }
  .nz-btn:hover .nz-star     { animation: nz-star    5s ease-in-out infinite; }

  .nz-btn-sm:hover           { animation: nz-glow-sm 4s ease-in-out infinite; }
  .nz-btn-sm:hover .nz-spin  { animation: nz-spin    8s linear      infinite; }
  .nz-btn-sm:hover .nz-star  { animation: nz-star    5s ease-in-out infinite; }
`;

function useNewBtnStyles() {
  useEffect(() => {
    const id = "nz-new-btn-styles";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id;
      el.textContent = NEW_BTN_CSS;
      document.head.appendChild(el);
    }
  }, []);
}

interface NewBtnProps {
  collapsed?: boolean;
  onNew: () => void;
  onAgentsOpen: () => void;
  onMcpOpen: () => void;
}

function NewButton({ collapsed, onNew, onAgentsOpen, onMcpOpen }: NewBtnProps) {
  useNewBtnStyles();

  const menuItems = (
    <>
      <DropdownMenuItem onClick={onNew}><SquarePen className="h-4 w-4 text-muted" /> New chat</DropdownMenuItem>
      <DropdownMenuItem onClick={onAgentsOpen}><Bot className="h-4 w-4 text-muted" /> Agents</DropdownMenuItem>
      <DropdownMenuItem onClick={onMcpOpen}><Server className="h-4 w-4 text-muted" /> MCP Servers</DropdownMenuItem>
    </>
  );

  if (collapsed) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button title="New" className="nz-btn-sm relative">
            <div style={{ position: "relative", overflow: "hidden", borderRadius: "12px", padding: "1.5px", width: "36px", height: "36px" }}>
              <div className="nz-spin" style={{ position: "absolute", inset: "-50%", background: "conic-gradient(from 0deg,#6d5efc 0%,#a78bfa 28%,#38bdf8 52%,#818cf8 76%,#6d5efc 100%)" }} />
              <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", borderRadius: "9px", background: "#0e0b24", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="nz-star" style={{ display: "inline-block", color: "white", fontSize: "15px" }}>✦</span>
              </div>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-40">
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="nz-btn relative w-full">
          {/* Spinning conic-gradient border */}
          <div style={{ position: "relative", overflow: "hidden", borderRadius: "12px", padding: "1.5px" }}>
            <div className="nz-spin" style={{ position: "absolute", inset: "-50%", background: "conic-gradient(from 0deg,#6d5efc 0%,#a78bfa 28%,#38bdf8 52%,#818cf8 76%,#6d5efc 100%)" }} />

            {/* Button face */}
            <div style={{ position: "relative", overflow: "hidden", borderRadius: "10px", background: "#0d0b22", padding: "10px 16px" }}>
              {/* Shimmer sweep */}
              <div className="nz-shimmer" style={{
                position: "absolute", top: 0, bottom: 0, width: "64px",
                background: "linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent)",
                pointerEvents: "none",
              }} />

              <span style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "white", fontWeight: 600, letterSpacing: "0.06em", fontSize: "14px" }}>
                <span className="nz-star" style={{ display: "inline-block" }}>✦</span>
                New
              </span>
            </div>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {menuItems}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Small ⋯ button using Radix DropdownMenu (portal-rendered — not clipped by nav overflow). */
function ConvoMenu({
  onRename,
  onDelete,
}: {
  onRename: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded text-muted opacity-0 transition-opacity hover:bg-surface hover:text-fg group-hover:opacity-100"
          title="Options"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-36">
        <DropdownMenuItem onClick={(e) => onRename(e as unknown as React.MouseEvent)}>
          <Pencil className="h-3.5 w-3.5 text-muted" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-danger focus:bg-danger/10 focus:text-danger"
          onClick={(e) => onDelete(e as unknown as React.MouseEvent)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A thin grab strip on the sidebar's right edge. Drag it left past a threshold
 * to collapse the sidebar, or (from the collapsed rail) drag right to expand —
 * the same result as the collapse/expand button.
 */
function EdgeDragHandle({ onCollapse, onExpand }: { onCollapse?: () => void; onExpand?: () => void }) {
  const startX = useRef<number | null>(null);
  const fired = useRef(false);
  const THRESHOLD = 56;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      title={onCollapse ? "Drag to collapse" : "Drag to expand"}
      onPointerDown={(e) => {
        startX.current = e.clientX;
        fired.current = false;
        try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (startX.current === null || fired.current) return;
        const dx = e.clientX - startX.current;
        if (onCollapse && dx <= -THRESHOLD) { fired.current = true; onCollapse(); }
        else if (onExpand && dx >= THRESHOLD) { fired.current = true; onExpand(); }
      }}
      onPointerUp={(e) => {
        startX.current = null;
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      }}
      className="group absolute right-0 top-0 z-20 flex h-full w-2 -mr-1 cursor-col-resize touch-none select-none items-center justify-center"
    >
      {/* visible line on hover/drag */}
      <span className="h-full w-px bg-transparent transition-colors group-hover:bg-accent/50 group-active:bg-accent" />
    </div>
  );
}

export function Sidebar({
  conversations,
  activeId,
  online,
  user,
  onNew,
  onSelect,
  onDelete,
  onRename,
  onLogout,
  onAdminOpen,
  onAgentsOpen,
  onMcpOpen,
  onUserUpdated,
}: {
  conversations: Conversation[];
  activeId: string | null;
  online: boolean | null;
  user: User;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onAgentsOpen: () => void;
  onMcpOpen: () => void;
  onLogout: () => void;
  onAdminOpen: () => void;
  onUserUpdated: (u: User) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const committingRef = useRef(false);

  function startEdit(c: Conversation, e: React.MouseEvent) {
    e.stopPropagation();
    committingRef.current = false;
    setEditingId(c.id);
    setDraft(c.title);
    setTimeout(() => { inputRef.current?.select(); }, 0);
  }

  function commitEdit(id: string) {
    if (committingRef.current) return; // prevent double-fire from blur+Enter
    committingRef.current = true;
    const title = draft.trim();
    if (title) onRename(id, title);
    setEditingId(null);
  }

  // Show username as the primary label everywhere in the sidebar
  const displayLabel = user.username;
  const subLabel = user.displayName && user.displayName !== user.username
    ? user.displayName
    : null;

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "1"
  );

  function setSidebarCollapsed(next: boolean) {
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
  }

  function toggleCollapse() {
    setSidebarCollapsed(!collapsed);
  }

  // ── Collapsed icon rail ─────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside className="relative flex w-14 flex-col items-center gap-2.5 border-r border-border bg-surface pb-3 pt-2.5 transition-all duration-200">
        <EdgeDragHandle onExpand={() => setSidebarCollapsed(false)} />
        {/* Logo */}
        <button
          onClick={toggleCollapse}
          title="Expand sidebar"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-accent-2 transition-colors hover:bg-surface-2"
        >
          {/* ⬡ glyph ink sits ~0.1em low in its line box; nudge up to optically center it in the button. */}
          <span className="inline-block text-4xl leading-none -translate-y-[4px]">⬡</span>
        </button>

        <div className="h-px w-8 bg-border" />

        {/* + New dropdown */}
        <NewButton collapsed onNew={onNew} onAgentsOpen={onAgentsOpen} onMcpOpen={onMcpOpen} />

        {/* Chats popover */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title="Chats"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:border-accent hover:text-fg"
            >
              <MessagesSquare className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-64 max-h-[70vh] overflow-y-auto">
            {/* Connections Chats */}
            {conversations.filter(c => c.integration).length > 0 && (
              <>
                <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted/60">
                  Connections Chats
                </div>
                {conversations.filter(c => c.integration).map(c => (
                  <DropdownMenuItem key={c.id} onClick={() => onSelect(c.id)}
                    className={c.id === activeId ? "bg-surface-2 text-fg" : ""}>
                    {c.integration === "telegram" && <SiTelegram className="h-3 w-3 flex-shrink-0 text-[#2AABEE]" />}
                {c.integration === "discord"  && <SiDiscord  className="h-3 w-3 flex-shrink-0 text-[#5865F2]" />}
                {c.integration === "slack"    && <SlackIcon className="h-3 w-3 flex-shrink-0" />}
                    <span className="truncate">{c.title}</span>
                  </DropdownMenuItem>
                ))}
                {conversations.filter(c => !c.integration).length > 0 && <DropdownMenuSeparator />}
              </>
            )}

            {/* Local Chats */}
            {conversations.filter(c => !c.integration).length > 0 && (
              <>
                <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted/60">
                  Local Chats
                </div>
                {conversations.filter(c => !c.integration).map(c => (
                  <DropdownMenuItem key={c.id} onClick={() => onSelect(c.id)}
                    className={c.id === activeId ? "bg-surface-2 text-fg" : ""}>
                    <span className="truncate">{c.title}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}

            {conversations.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-muted">No chats yet</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Expand button */}
        <button
          onClick={toggleCollapse}
          title="Expand sidebar"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <PanelLeftOpen className="h-5 w-5" />
        </button>

        {/* Avatar — opens profile dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title={displayLabel}
              className="relative flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-accent-2 transition-colors hover:bg-accent/30 focus:outline-none"
            >
              {user.username.charAt(0).toUpperCase()}
              {user.isAdmin && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent text-[7px] font-black text-white">A</span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-52">
            <div className="px-2.5 py-2">
              <p className="text-sm font-semibold text-fg">{displayLabel}</p>
              {subLabel && <p className="text-xs text-muted">{subLabel}</p>}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings className="h-4 w-4 text-muted" /> Settings
            </DropdownMenuItem>
            {user.isAdmin && (
              <DropdownMenuItem onClick={onAdminOpen}>
                <Shield className="h-4 w-4 text-accent-2" /> Admin panel
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onLogout}>
              <Users className="h-4 w-4 text-muted" /> Switch user
            </DropdownMenuItem>
            <DropdownMenuItem className="text-danger focus:bg-danger/10 focus:text-danger" onClick={onLogout}>
              <LogOut className="h-4 w-4" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </aside>
    );
  }

  // ── Full sidebar ─────────────────────────────────────────────────────────────

  return (
    <aside className="relative flex w-[264px] flex-shrink-0 flex-col gap-3 bg-surface border-r border-border p-3 transition-all duration-200">
      <EdgeDragHandle onCollapse={() => setSidebarCollapsed(true)} />
      <div className="flex items-center justify-between px-1.5 py-1">
        <div className="flex items-center gap-2 text-lg font-bold tracking-wide">
          <span className="inline-block text-2xl leading-none -translate-y-[1px] text-accent-2">⬡</span> EnzoAI
        </div>
        <button
          onClick={toggleCollapse}
          title="Collapse sidebar"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <PanelLeftClose className="h-5 w-5" />
        </button>
      </div>

      <NewButton onNew={onNew} onAgentsOpen={onAgentsOpen} onMcpOpen={onMcpOpen} />

      <nav className="flex flex-1 flex-col overflow-y-auto">
        {(() => {
          const local       = conversations.filter(c => !c.integration);
          const integrations = conversations.filter(c =>  c.integration);

          const renderConvo = (c: typeof conversations[0]) => (
            <div
              key={c.id}
              className={`group flex cursor-pointer items-center justify-between gap-1.5 rounded-lg px-2.5 py-2 text-muted hover:bg-surface-2 hover:text-fg ${
                c.id === activeId ? "bg-surface-2 text-fg" : ""
              }`}
              onClick={() => editingId !== c.id && onSelect(c.id)}
            >
              {editingId === c.id ? (
                <input
                  ref={inputRef}
                  className="min-w-0 flex-1 rounded bg-bg px-1.5 py-0.5 text-sm text-fg outline-none ring-1 ring-accent"
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onBlur={() => commitEdit(c.id)}
                  onKeyDown={e => {
                    if (e.key === "Enter") { e.preventDefault(); commitEdit(c.id); }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={e => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                  {c.integration === "telegram" && <SiTelegram className="h-3 w-3 flex-shrink-0 text-[#2AABEE]" />}
                {c.integration === "discord"  && <SiDiscord  className="h-3 w-3 flex-shrink-0 text-[#5865F2]" />}
                {c.integration === "slack"    && <SlackIcon className="h-3 w-3 flex-shrink-0" />}
                  <span className="truncate text-sm">{c.title}</span>
                </div>
              )}

              {editingId !== c.id && !c.integration && (
                <ConvoMenu
                  onRename={(e) => startEdit(c, e)}
                  onDelete={(e) => { e.stopPropagation(); onDelete(c.id); }}
                />
              )}
            </div>
          );

          return (
            <>
              {/* ── Integrations section ── */}
              {integrations.length > 0 && (
                <div className="mb-1">
                  <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted/60">
                    Connections Chats
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {integrations.map(renderConvo)}
                  </div>
                </div>
              )}

              {/* ── Local chats section ── */}
              {integrations.length > 0 && local.length > 0 && (
                <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted/60">
                  Local Chats
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {local.map(renderConvo)}
              </div>
              {conversations.length === 0 && (
                <div className="px-1.5 py-2 text-xs text-muted">No conversations yet</div>
              )}
            </>
          );
        })()}
      </nav>

      {/* ── Profile footer with dropdown menu ── */}
      <div className="border-t border-border pt-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2 focus:outline-none">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-accent-2">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                {user.isAdmin && (
                  <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[8px] font-black text-white">
                    A
                  </div>
                )}
              </div>

              {/* Name */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-semibold leading-tight">
                    {displayLabel}
                  </span>
                  {user.isAdmin && (
                    <span className="flex-shrink-0 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent-2">
                      Admin
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-muted leading-tight">
                  {subLabel
                    ? subLabel
                    : online === false
                      ? "Engine offline"
                      : "Local · private"}
                </div>
              </div>

              <ChevronUp className="h-3.5 w-3.5 flex-shrink-0 text-muted transition-transform duration-150 [[data-state=open]_&]:rotate-180" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" align="start" className="w-52">
            {/* User info header */}
            <div className="px-2.5 py-2">
              <p className="text-sm font-semibold text-fg">{displayLabel}</p>
              {subLabel && <p className="text-xs text-muted">{subLabel}</p>}
              {user.superPowers && (
                <p className="mt-0.5 truncate text-[11px] text-muted/80">⚡ {user.superPowers}</p>
              )}
            </div>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <Settings className="h-4 w-4 text-muted" />
              Settings
            </DropdownMenuItem>

            {user.isAdmin && (
              <DropdownMenuItem onClick={onAdminOpen}>
                <Shield className="h-4 w-4 text-accent-2" />
                <span>Admin panel</span>
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={onLogout}>
              <Users className="h-4 w-4 text-muted" />
              Switch user
            </DropdownMenuItem>

            <DropdownMenuItem
              className="text-danger focus:bg-danger/10 focus:text-danger"
              onClick={onLogout}
            >
              <LogOut className="h-4 w-4" />
              Log out
            </DropdownMenuItem>

          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Settings dialog */}
      <SettingsPanel
        open={settingsOpen}
        user={user}
        onClose={() => setSettingsOpen(false)}
        onUpdated={(updated) => {
          onUserUpdated(updated);
          setSettingsOpen(false);
        }}
      />
    </aside>
  );
}
