import { useRef, useState } from "react";
import { Settings, Shield, LogOut, ChevronUp, Users, MoreHorizontal, Pencil, Trash2, Bot } from "lucide-react";
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
  // Show full display name (first + last) as a sub-label if it differs from the username
  const subLabel = user.displayName && user.displayName !== user.username
    ? user.displayName
    : null;

  return (
    <aside className="flex flex-col gap-3 bg-surface border-r border-border p-3">
      <div className="flex items-center gap-2 px-1.5 py-1 text-lg font-bold tracking-wide">
        <span className="text-accent-2">⬡</span> enzo ai
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

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {conversations.map((c) => (
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
              <span className="truncate text-sm">{c.title}</span>
            )}

            {/* ⋯ kebab — visible on hover, opens an inline action menu */}
            {editingId !== c.id && (
              <ConvoMenu
                onRename={(e) => startEdit(c, e)}
                onDelete={(e) => { e.stopPropagation(); onDelete(c.id); }}
              />
            )}
          </div>
        ))}
        {conversations.length === 0 && (
          <div className="px-1.5 py-2 text-xs text-muted">
            No conversations yet
          </div>
        )}
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
