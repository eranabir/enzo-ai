import type { Conversation, User } from "../types";

export function Sidebar({
  conversations,
  activeId,
  online,
  user,
  onNew,
  onSelect,
  onDelete,
  onLogout,
}: {
  conversations: Conversation[];
  activeId: string | null;
  online: boolean | null;
  user: User;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
}) {
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

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-sm font-bold text-accent-2">
          {user.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{user.displayName}</div>
          <div className="truncate text-[11px] text-muted">
            {online === false ? "Engine offline" : "Local · private"}
          </div>
        </div>
        <button
          onClick={onLogout}
          title="Sign out"
          className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-danger"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
