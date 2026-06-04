import { useRef, useState } from "react";
import { Settings, Shield, LogOut, ChevronUp, ChevronLeft, ChevronRight, Users, MoreHorizontal, Pencil, Trash2, Bot, SquarePen, MessagesSquare } from "lucide-react";
import { SiTelegram, SiDiscord } from "react-icons/si";
import type { Conversation, User } from "../types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";
import { SettingsPanel } from "./SettingsPanel";


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

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
  }

  // ── Collapsed icon rail ─────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <aside className="flex w-14 flex-col items-center gap-3 border-r border-border bg-surface py-3 transition-all duration-200">
        {/* Logo */}
        <button
          onClick={toggleCollapse}
          title="Expand sidebar"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-accent-2 transition-colors hover:bg-surface-2"
        >
          <span className="text-xl">⬡</span>
        </button>

        <div className="h-px w-8 bg-border" />

        {/* New chat */}
        <button
          title="New chat"
          onClick={onNew}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-[0_0_12px_rgba(109,94,252,0.3)] transition-colors hover:bg-accent-2"
        >
          <SquarePen className="h-4 w-4" />
        </button>

        {/* Agents */}
        <button
          title="Agents"
          onClick={onAgentsOpen}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted transition-colors hover:border-accent hover:text-fg"
        >
          <Bot className="h-4 w-4" />
        </button>

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
            {/* Integration Chats */}
            {conversations.filter(c => c.integration).length > 0 && (
              <>
                <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted/60">
                  Integration Chats
                </div>
                {conversations.filter(c => c.integration).map(c => (
                  <DropdownMenuItem key={c.id} onClick={() => onSelect(c.id)}
                    className={c.id === activeId ? "bg-surface-2 text-fg" : ""}>
                    {c.integration === "telegram" && <SiTelegram className="h-3 w-3 flex-shrink-0 text-[#2AABEE]" />}
                {c.integration === "discord"  && <SiDiscord  className="h-3 w-3 flex-shrink-0 text-[#5865F2]" />}
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
          <ChevronRight className="h-4 w-4" />
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
    <aside className="flex w-[264px] flex-shrink-0 flex-col gap-3 bg-surface border-r border-border p-3 transition-all duration-200">
      <div className="flex items-center justify-between px-1.5 py-1">
        <div className="flex items-center gap-2 text-lg font-bold tracking-wide">
          <span className="text-accent-2">⬡</span> EnzoAI
        </div>
        <button
          onClick={toggleCollapse}
          title="Collapse sidebar"
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <button
          className="w-full rounded-xl bg-accent py-2.5 font-semibold text-white transition-colors hover:bg-accent-2"
          onClick={onNew}
        >
          + New chat
        </button>
        <button
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 py-2 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-fg"
          onClick={onAgentsOpen}
        >
          <Bot className="h-4 w-4" />
          Agents
        </button>
      </div>

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
                    Integration Chats
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
