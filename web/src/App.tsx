import { useCallback, useEffect, useRef, useState } from "react";
import { api, getToken, setToken, streamChat } from "./api";
import type { Chat, Message, ModelInfo, User } from "./types";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Composer, type AttachedImage } from "./components/Composer";
import { Header } from "./components/Header";
import { AuthScreen } from "./components/AuthScreen";
import { UnlockScreen } from "./components/UnlockScreen";
import { AdminPanel } from "./components/AdminPanel";
import { AgentsPanel } from "./components/AgentsPanel";
import { McpPanel } from "./components/McpPanel";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // null = unknown, true = vault configured but locked, false = ready/unlocked
  const [vaultLocked, setVaultLocked] = useState<boolean | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<string>("");
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Restore an existing session on load, if any.
  useEffect(() => {
    if (!getToken()) {
      setAuthChecked(true);
      return;
    }
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setToken(null))
      .finally(() => setAuthChecked(true));
  }, []);

  // Once signed in, find out whether encryption is on and locked.
  useEffect(() => {
    if (!user) { setVaultLocked(null); return; }
    api.vault.status()
      .then((s) => setVaultLocked(s.configured && !s.unlocked))
      .catch(() => setVaultLocked(false)); // never hard-block on a status error
  }, [user]);

  // Poll engine status so the UI reflects Ollama coming up or down.
  useEffect(() => {
    const ping = () =>
      api.status().then((s) => setOnline(s.ollama)).catch(() => setOnline(false));
    ping();
    const t = setInterval(ping, 5000);
    return () => clearInterval(t);
  }, []);

  // Load this user's chats + the model list once signed in and the
  // engine is reachable (handles the UI opening before Ollama has started).
  const refreshModels = useCallback(() => {
    if (!online || !user) return;
    api
      .models()
      .then(({ models, default: def }) => {
        setModels(models);
        setModel((m) => m || models[0]?.id || def);
      })
      .catch(() => {});
  }, [online, user]);

  const refreshChats = useCallback(() => {
    if (!online || !user) return;
    api.listChats().then(setChats).catch(() => {});
  }, [online, user]);

  useEffect(() => {
    if (!online || !user) return;
    refreshChats();
    refreshModels();
  }, [online, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when the tab regains focus — picks up server-created chats
  // (e.g. Telegram integration chat appearing after bot connects)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refreshModels();
        refreshChats();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshModels, refreshChats]);

  // Poll chats every 15s so integration chats (Telegram, etc.) appear
  // without the user needing to refresh. Lightweight — only fetches the list.
  useEffect(() => {
    if (!online || !user) return;
    const t = setInterval(refreshChats, 15_000);
    return () => clearInterval(t);
  }, [online, user, refreshChats]);

  // Poll messages every 4s when viewing an integration chat (Discord/Telegram)
  // so new messages from the bot appear automatically without refreshing.
  useEffect(() => {
    if (!activeId || !online || !user || busy) return;
    const activeConvo = chats.find((c) => c.id === activeId);
    if (!activeConvo?.connection) return; // only for integration chats

    const t = setInterval(async () => {
      try {
        const detail = await api.getChat(activeId);
        setMessages(detail.messages);
      } catch { /* ignore */ }
    }, 4_000);
    return () => clearInterval(t);
  }, [activeId, online, user, busy, chats]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setToken(null);
    setUser(null);
    setChats([]);
    setMessages([]);
    setActiveId(null);
  }, []);

  const openChat = useCallback(async (id: string) => {
    setActiveId(id);
    const detail = await api.getChat(id);
    setMessages(detail.messages);
    if (detail.model) setModel(detail.model);
  }, []);

  const newChat = useCallback(async () => {
    const c = await api.createChat();
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    setMessages([]);
  }, []);

  const deleteChat = useCallback(
    async (id: string) => {
      await api.deleteChat(id);
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    },
    [activeId],
  );

  const renameChat = useCallback(async (id: string, title: string) => {
    // Optimistic update first so the UI feels instant
    setChats((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c)),
    );
    // Persist to the server
    await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-enzo-ai-token": getToken() ?? "",
      },
      body: JSON.stringify({ title }),
    }).catch(() => {
      // Revert on failure
      setChats((prev) =>
        prev.map((c) => (c.id === id && c.title === title ? { ...c, title: c.title } : c)),
      );
    });
  }, []);

  const send = useCallback(
    async (content: string, image?: AttachedImage) => {
      if (busy) return;
      let convoId = activeId;

      // Lazily create a chat on first send.
      if (!convoId) {
        const c = await api.createChat();
        setChats((prev) => [c, ...prev]);
        setActiveId(c.id);
        convoId = c.id;
      }

      const userMsg: Message = {
        id: crypto.randomUUID(),
        chat_id: convoId,
        role: "user",
        content,
        image_mime: image?.mime ?? null,
        created_at: Date.now(),
      };
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        chat_id: convoId,
        role: "assistant",
        content: "",
        created_at: Date.now() + 1,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      await streamChat(
        { chatId: convoId, content, model, imageBase64: image?.base64, imageMime: image?.mime },
        {
          onToken: (token) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content + token }
                  : m,
              ),
            ),
          onTitle: (title) =>
            setChats((prev) =>
              prev.map((c) => (c.id === convoId ? { ...c, title } : c)),
            ),
          onError: (msg) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content + `\n\n⚠️ ${msg}` }
                  : m,
              ),
            ),
        },
        controller.signal,
      ).finally(() => {
        setBusy(false);
        abortRef.current = null;
      });
    },
    [activeId, busy, model],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const activeChat = chats.find((c) => c.id === activeId) ?? null;

  const toggleMemory = useCallback(
    async (enabled: boolean) => {
      if (!activeId) return;
      const updated = await api.setMemory(activeId, enabled).catch(() => null);
      if (updated) {
        setChats((prev) =>
          prev.map((c) => (c.id === activeId ? { ...c, memory_enabled: enabled ? 1 : 0 } : c)),
        );
      }
    },
    [activeId],
  );

  // Wait until we know whether a session exists, then gate on auth.
  if (!authChecked) return <div className="h-screen bg-bg" />;
  if (!user) return <AuthScreen onAuthed={setUser} online={online} />;
  // Encryption gate: if the vault is configured but locked, require the passphrase.
  if (vaultLocked === null) return <div className="h-screen bg-bg" />;
  if (vaultLocked)
    return (
      <UnlockScreen
        onUnlocked={() => { setVaultLocked(false); refreshChats(); refreshModels(); }}
        onLogout={logout}
      />
    );

  return (
    <div className="flex h-screen">
      {mcpOpen && <McpPanel onClose={() => setMcpOpen(false)} />}
      {agentsOpen && (
        <AgentsPanel
          onStartChat={async (agentId) => {
            const c = await api.createChat(agentId);
            setChats(prev => [c, ...prev]);
            setActiveId(c.id);
            setMessages([]);
          }}
          onClose={() => setAgentsOpen(false)}
        />
      )}
      {adminOpen && user.isAdmin && (
        <AdminPanel
          currentUser={user}
          onClose={() => {
            setAdminOpen(false);
            // Refresh models + chats — integrations may have added new chats
            api.models().then(({ models: m, default: def }) => {
              setModels(m);
              setModel((cur) => m.find(x => x.id === cur) ? cur : m[0]?.id || def);
            }).catch(() => {});
            refreshChats();
          }}
        />
      )}
      <Sidebar
        chats={chats}
        activeId={activeId}
        online={online}
        user={user}
        onNew={newChat}
        onSelect={openChat}
        onDelete={deleteChat}
        onRename={renameChat}
        onLogout={logout}
        onAdminOpen={() => setAdminOpen(true)}
        onAgentsOpen={() => setAgentsOpen(true)}
        onMcpOpen={() => setMcpOpen(true)}
        onUserUpdated={setUser}
      />
      <main className="flex flex-1 flex-col min-w-0">
        <Header
          models={models}
          model={model}
          online={online}
          activeChat={activeChat}
          onModelChange={setModel}
          onToggleMemory={toggleMemory}
        />
        <ChatView
          messages={messages}
          busy={busy}
          online={online}
          hasActiveChat={activeId !== null}
          onNewChat={newChat}
          onSend={(text) => send(text)}
        />
        <Composer
          busy={busy}
          disabled={online === false}
          canAttachImage={models.find(m => m.id === model)?.supportsVision ?? false}
          onSend={send}
          onStop={stop}
        />
      </main>
    </div>
  );
}
