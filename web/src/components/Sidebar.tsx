import { useState } from "react";
import { Settings, Shield, LogOut, ChevronUp, Users } from "lucide-react";
import type { Conversation, User } from "../types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu";
import { SettingsPanel } from "./SettingsPanel";

export function Sidebar({
  conversations,
  activeId,
  online,
  user,
  onNew,
  onSelect,
  onDelete,
  onLogout,
  onAdminOpen,
  onUserUpdated,
}: {
  conversations: Conversation[];
  activeId: string | null;
  online: boolean | null;
  user: User;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
  onAdminOpen: () => void;
  onUserUpdated: (u: User) => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Display name: prefer nickname, fall back to displayName
  const displayLabel = user.nickname || user.displayName;
  // Sub-label: show nickname + full name if nickname is set, otherwise just status
  const subLabel = user.nickname
    ? user.displayName !== user.nickname
      ? user.displayName
      : null
    : null;

  return (
    <aside className="flex flex-col gap-3 bg-surface border-r border-border p-3">
      <div className="flex items-center gap-2 px-1.5 py-1 text-lg font-bold tracking-wide">
        <span className="text-accent-2">⬡</span> enzo
      </div>

      <button
        className="rounded-xl bg-accent py-2.5 font-semibold text-white transition-colors hover:bg-accent-2"
        onClick={onNew}
      >
        + New chat
      </button>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex cursor-pointer items-center justify-between gap-1.5 rounded-lg px-2.5 py-2.5 text-muted hover:bg-surface-2 hover:text-fg ${
              c.id === activeId ? "bg-surface-2 text-fg" : ""
            }`}
            onClick={() => onSelect(c.id)}
          >
            <span className="truncate text-sm">{c.title}</span>
            <button
              className="text-xs text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
            >
              ✕
            </button>
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
                  {(user.firstName || user.displayName).charAt(0).toUpperCase()}
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
