import { useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, useMatch } from "react-router-dom";
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
import { KnowledgePanel } from "./components/KnowledgePanel";
import { SettingsPanel } from "./components/SettingsPanel";

const PANEL_PATHS = ["/settings", "/admin", "/agents", "/mcp", "/knowledge"];

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
  const abortRef = useRef<AbortController | null>(null);
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const navigate = useNavigate();
  const location = useLocation();
  const chatMatch = useMatch("/chat/:chatId");
  const routeChatId = chatMatch?.params.chatId ?? null;
  const onPanel = PANEL_PATHS.some((p) => location.pathname.startsWith(p));

  // The URL drives which chat is open. Loads messages when navigating to a chat
  // that isn't already active; clears at "/"; leaves the chat untouched while a
  // panel (settings/admin/…) overlays it.
  useEffect(() => {
    if (onPanel) return;
    if (routeChatId) {
      if (routeChatId !== activeIdRef.current) {
        setActiveId(routeChatId);
        api.getChat(routeChatId)
          .then((d) => { setMessages(d.messages); if (d.model) setModel(d.model); })
          .catch(() => navigate("/", { replace: true }));
      }
    } else if (location.pathname === "/" && activeIdRef.current !== null) {
      setActiveId(null);
      setMessages([]);
    }
  }, [routeChatId, location.pathname, onPanel, navigate]);

  // After streaming, reload authoritative messages so client ids match the
  // server's (needed for regenerate / edit, which re-mint message ids).
  const syncMessages = useCallback((convoId: string) => {
    api.getChat(convoId)
      .then((d) => { if (activeIdRef.current === convoId) setMessages(d.messages); })
      .catch(() => {});
  }, []);

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
    navigate("/login", { replace: true });
  }, [navigate]);

  // Selecting a chat is just navigation; the route effect loads its messages.
  const openChat = useCallback((id: string) => navigate(`/chat/${id}`), [navigate]);

  const newChat = useCallback(async () => {
    const c = await api.createChat();
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);     // set first so the route effect doesn't reload over us
    setMessages([]);
    navigate(`/chat/${c.id}`);
  }, [navigate]);

  const deleteChat = useCallback(
    async (id: string) => {
      await api.deleteChat(id);
      setChats((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) navigate("/", { replace: true });
    },
    [activeId, navigate],
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

  // Shared SSE handlers that stream tokens into a given assistant message.
  const streamInto = (assistantId: string, convoId: string) => ({
    onToken: (token: string) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + token } : m))),
    onTitle: (title: string) =>
      setChats((prev) => prev.map((c) => (c.id === convoId ? { ...c, title } : c))),
    onError: (msg: string) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + `\n\n⚠️ ${msg}` } : m))),
  });

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
        navigate(`/chat/${c.id}`);
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
        streamInto(assistantMsg.id, convoId),
        controller.signal,
      ).finally(() => {
        setBusy(false);
        abortRef.current = null;
        syncMessages(convoId);
      });
    },
    [activeId, busy, model, navigate, syncMessages],
  );

  // Re-run the assistant reply for the user message preceding `assistantId`.
  const regenerate = useCallback(
    async (assistantId: string) => {
      if (busy || !activeId) return;
      const idx = messages.findIndex((m) => m.id === assistantId);
      if (idx < 0) return;
      let u = idx - 1;
      while (u >= 0 && messages[u].role !== "user") u--;
      if (u < 0) return;
      const userMsg = messages[u];
      const convoId = activeId;
      const assistantMsg: Message = { id: crypto.randomUUID(), chat_id: convoId, role: "assistant", content: "", created_at: Date.now() };
      setMessages((prev) => [...prev.slice(0, u + 1), assistantMsg]);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      await streamChat(
        { chatId: convoId, content: userMsg.content, model, replaceFromMessageId: userMsg.id },
        streamInto(assistantMsg.id, convoId),
        controller.signal,
      ).finally(() => { setBusy(false); abortRef.current = null; syncMessages(convoId); });
    },
    [activeId, busy, messages, model],
  );

  // Edit a user message and resend (drops everything after it).
  const editMessage = useCallback(
    async (userMsgId: string, newContent: string) => {
      if (busy || !activeId || !newContent.trim()) return;
      const idx = messages.findIndex((m) => m.id === userMsgId);
      if (idx < 0) return;
      const convoId = activeId;
      const editedUser: Message = { ...messages[idx], content: newContent };
      const assistantMsg: Message = { id: crypto.randomUUID(), chat_id: convoId, role: "assistant", content: "", created_at: Date.now() };
      setMessages((prev) => [...prev.slice(0, idx), editedUser, assistantMsg]);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      await streamChat(
        { chatId: convoId, content: newContent, model, replaceFromMessageId: userMsgId },
        streamInto(assistantMsg.id, convoId),
        controller.signal,
      ).finally(() => { setBusy(false); abortRef.current = null; syncMessages(convoId); });
    },
    [activeId, busy, messages, model],
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

  const closePanel = () => navigate(activeId ? `/chat/${activeId}` : "/");

  // Wait until we know whether a session exists, then route.
  if (!authChecked) return <div className="h-screen bg-bg" />;

  const workspace = (user: User) => (
    <div className="flex h-screen">
      {onPanel && location.pathname.startsWith("/mcp") && <McpPanel onClose={closePanel} />}
      {onPanel && location.pathname.startsWith("/knowledge") && (
        <KnowledgePanel
          onClose={closePanel}
          onStartChat={async (knowledgeBaseId) => {
            const c = await api.createChat({ knowledgeBaseId });
            setChats((prev) => [c, ...prev]);
            setActiveId(c.id);
            setMessages([]);
            navigate(`/chat/${c.id}`);
          }}
        />
      )}
      {onPanel && location.pathname.startsWith("/agents") && (
        <AgentsPanel
          onStartChat={async (agentId) => {
            const c = await api.createChat(agentId);
            setChats((prev) => [c, ...prev]);
            setActiveId(c.id);
            setMessages([]);
            navigate(`/chat/${c.id}`);
          }}
          onClose={closePanel}
        />
      )}
      {onPanel && location.pathname.startsWith("/admin") && user.isAdmin && (
        <AdminPanel
          currentUser={user}
          onClose={() => {
            // Refresh models + chats — integrations may have added new chats
            api.models().then(({ models: m, default: def }) => {
              setModels(m);
              setModel((cur) => (m.find((x) => x.id === cur) ? cur : m[0]?.id || def));
            }).catch(() => {});
            refreshChats();
            closePanel();
          }}
        />
      )}
      {onPanel && location.pathname.startsWith("/settings") && (
        <SettingsPanel
          open
          user={user}
          onClose={closePanel}
          onUpdated={(u) => { setUser(u); closePanel(); }}
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
        onAdminOpen={() => navigate("/admin")}
        onAgentsOpen={() => navigate("/agents")}
        onMcpOpen={() => navigate("/mcp")}
        onKnowledgeOpen={() => navigate("/knowledge")}
        onSettingsOpen={() => navigate("/settings")}
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
          onRegenerate={regenerate}
          onEditMessage={editMessage}
        />
        <Composer
          busy={busy}
          disabled={online === false}
          canAttachImage={models.find((m) => m.id === model)?.supportsVision ?? false}
          onSend={send}
          onStop={stop}
        />
      </main>
    </div>
  );

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <AuthScreen onAuthed={setUser} online={online} />}
      />
      <Route
        path="/unlock"
        element={
          !user ? <Navigate to="/login" replace />
            : vaultLocked === null ? <div className="h-screen bg-bg" />
            : !vaultLocked ? <Navigate to="/" replace />
            : <UnlockScreen
                onUnlocked={() => { setVaultLocked(false); refreshChats(); refreshModels(); navigate("/", { replace: true }); }}
                onLogout={logout}
              />
        }
      />
      <Route
        path="*"
        element={
          !user ? <Navigate to="/login" replace />
            : vaultLocked === null ? <div className="h-screen bg-bg" />
            : vaultLocked ? <Navigate to="/unlock" replace />
            : workspace(user)
        }
      />
    </Routes>
  );
}
