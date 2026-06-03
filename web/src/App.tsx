import { useCallback, useEffect, useRef, useState } from "react";
import { api, getToken, setToken, streamChat } from "./api";
import type { Conversation, Message, ModelInfo, User } from "./types";
import { Sidebar } from "./components/Sidebar";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { Header } from "./components/Header";
import { AuthScreen } from "./components/AuthScreen";
import { AdminPanel } from "./components/AdminPanel";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<string>("");
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
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

  // Poll engine status so the UI reflects Ollama coming up or down.
  useEffect(() => {
    const ping = () =>
      api.status().then((s) => setOnline(s.ollama)).catch(() => setOnline(false));
    ping();
    const t = setInterval(ping, 5000);
    return () => clearInterval(t);
  }, []);

  // Load this user's conversations + the model list once signed in and the
  // engine is reachable (handles the UI opening before Ollama has started).
  useEffect(() => {
    if (!online || !user) return;
    api.listConversations().then(setConversations).catch(() => {});
    api
      .models()
      .then(({ models, default: def }) => {
        setModels(models);
        setModel((m) => m || models[0]?.id || def);
      })
      .catch(() => {});
  }, [online, user]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setToken(null);
    setUser(null);
    setConversations([]);
    setMessages([]);
    setActiveId(null);
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setActiveId(id);
    const detail = await api.getConversation(id);
    setMessages(detail.messages);
    if (detail.model) setModel(detail.model);
  }, []);

  const newConversation = useCallback(async () => {
    const c = await api.createConversation();
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    setMessages([]);
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    },
    [activeId],
  );

  const send = useCallback(
    async (content: string) => {
      if (busy) return;
      let convoId = activeId;

      // Lazily create a conversation on first send.
      if (!convoId) {
        const c = await api.createConversation();
        setConversations((prev) => [c, ...prev]);
        setActiveId(c.id);
        convoId = c.id;
      }

      const userMsg: Message = {
        id: crypto.randomUUID(),
        conversation_id: convoId,
        role: "user",
        content,
        created_at: Date.now(),
      };
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        conversation_id: convoId,
        role: "assistant",
        content: "",
        created_at: Date.now() + 1,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      await streamChat(
        { conversationId: convoId, content, model },
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
            setConversations((prev) =>
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

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;

  const toggleMemory = useCallback(
    async (enabled: boolean) => {
      if (!activeId) return;
      const updated = await api.setMemory(activeId, enabled).catch(() => null);
      if (updated) {
        setConversations((prev) =>
          prev.map((c) => (c.id === activeId ? { ...c, memory_enabled: enabled ? 1 : 0 } : c)),
        );
      }
    },
    [activeId],
  );

  // Wait until we know whether a session exists, then gate on auth.
  if (!authChecked) return <div className="h-screen bg-bg" />;
  if (!user) return <AuthScreen onAuthed={setUser} online={online} />;

  return (
    <div className="grid grid-cols-[264px_1fr] h-screen">
      {adminOpen && user.isAdmin && (
        <AdminPanel currentUser={user} onClose={() => setAdminOpen(false)} />
      )}
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        online={online}
        user={user}
        onNew={newConversation}
        onSelect={openConversation}
        onDelete={deleteConversation}
        onLogout={logout}
        onAdminOpen={() => setAdminOpen(true)}
        onUserUpdated={setUser}
      />
      <main className="flex flex-col min-w-0">
        <Header
          models={models}
          model={model}
          online={online}
          activeConversation={activeConversation}
          onModelChange={setModel}
          onToggleMemory={toggleMemory}
        />
        <ChatView messages={messages} busy={busy} online={online} />
        <Composer busy={busy} disabled={online === false} onSend={send} onStop={stop} />
      </main>
    </div>
  );
}
