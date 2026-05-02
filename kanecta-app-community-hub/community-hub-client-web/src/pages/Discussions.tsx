import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import MessageItem from "../components/discussions/MessageItem";
import MessageInput from "../components/discussions/MessageInput";
import CreateThreadModal from "../components/discussions/CreateThreadModal";
import ReplyPanel from "../components/discussions/ReplyPanel";
import { useUserRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { useThreadSocket } from "../hooks/useSocket";
import { api, type Thread, type Message, type Reaction } from "../api/discussions";
import keycloak from "../auth/keycloak";

export default function Discussions() {
  const role = useUserRole();
  const { authenticated } = useKeycloak();
  const navigate = useNavigate();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showCreateThread, setShowCreateThread] = useState(false);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const currentUserId = keycloak.tokenParsed?.sub || "";
  const canModerate = role === "MODERATOR";

  useEffect(() => {
    if (role === "PUBLIC") navigate("/", { replace: true });
    else if (role === "LOCAL" || role === "RESILIENCE") navigate("/discussions/team-required", { replace: true });
  }, [role, navigate]);

  useEffect(() => {
    if (!authenticated) return;
    api.threads.list().then((data) => {
      setThreads(data);
      if (data.length > 0) setActiveThreadId(data[0].id);
    }).finally(() => setLoadingThreads(false));
  }, [authenticated]);

  useEffect(() => {
    if (!activeThreadId) return;
    setLoadingMessages(true);
    setMessages([]);
    api.messages.list(activeThreadId).then(setMessages).finally(() => setLoadingMessages(false));
  }, [activeThreadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleNewMessage = useCallback((data: unknown) => {
    setMessages((prev) => [...prev, data as Message]);
  }, []);

  const handleEditMessage = useCallback((data: unknown) => {
    const msg = data as Message;
    setMessages((prev) => prev.map((m) => m.id === msg.id ? msg : m));
  }, []);

  const handleDeleteMessage = useCallback((data: unknown) => {
    const { id } = data as { id: string };
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, deleted_at: new Date().toISOString(), content: "" } : m));
  }, []);

  const handleReactionUpdate = useCallback((data: unknown) => {
    const { message_id, reactions: r } = data as { message_id: string; reactions: Reaction[] };
    setReactions((prev) => ({ ...prev, [message_id]: r }));
  }, []);

  const handleNewThread = useCallback((data: unknown) => {
    setThreads((prev) => [...prev, data as Thread]);
  }, []);

  useThreadSocket(activeThreadId, {
    "message:new": handleNewMessage,
    "message:edit": handleEditMessage,
    "message:delete": handleDeleteMessage,
    "reaction:update": handleReactionUpdate,
    "thread:new": handleNewThread,
  });

  async function sendMessage(content: string) {
    if (!activeThreadId) return;
    await api.messages.post(activeThreadId, content);
  }

  async function editMessage(id: string, content: string) {
    await api.messages.edit(id, content);
  }

  async function deleteMessage(id: string) {
    await api.messages.delete(id);
  }

  async function react(messageId: string, emoji: string) {
    const updated = await api.reactions.add(messageId, emoji);
    setReactions((prev) => ({ ...prev, [messageId]: updated }));
  }

  async function unreact(messageId: string, emoji: string) {
    const updated = await api.reactions.remove(messageId, emoji);
    setReactions((prev) => ({ ...prev, [messageId]: updated }));
  }

  async function createThread(name: string, description?: string) {
    await api.threads.create(name, description);
  }

  if (role !== "TEAM" && role !== "MODERATOR") return null;

  return (
    <div className="discussions-page">
      <Header />
      <Breadcrumb pageName="Discussions" />
      <div className="discussions-layout">

        <aside className="discussions-sidebar">
          <div className="discussions-sidebar__heading">
            Threads
            <button className="discussions-sidebar__new" onClick={() => setShowCreateThread(true)} title="New thread">+</button>
          </div>
          {loadingThreads ? (
            <div className="discussions-sidebar__loading">Loading…</div>
          ) : threads.length === 0 ? (
            <div className="discussions-sidebar__empty">No threads yet. Create one!</div>
          ) : (
            <ul className="discussions-sidebar__list">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    className={`discussions-thread-item${t.id === activeThreadId ? " discussions-thread-item--active" : ""}`}
                    onClick={() => setActiveThreadId(t.id)}
                  >
                    <span className="discussions-thread-item__hash">#</span>
                    <span className="discussions-thread-item__name">{t.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className="discussions-main">
          {activeThread && (
            <div className="discussions-main__header">
              <span className="discussions-main__hash">#</span>
              {activeThread.name}
              {activeThread.description && (
                <span className="discussions-main__description">{activeThread.description}</span>
              )}
            </div>
          )}

          <div className="discussions-main__messages">
            {loadingMessages ? (
              <div className="discussions-messages__loading">Loading messages…</div>
            ) : messages.length === 0 ? (
              <div className="discussions-messages__empty">No messages yet. Say hello!</div>
            ) : (
              messages.map((msg) => (
                <MessageItem
                  key={msg.id}
                  message={msg}
                  reactions={reactions[msg.id] || []}
                  currentUserId={currentUserId}
                  canModerate={canModerate}
                  onEdit={editMessage}
                  onDelete={deleteMessage}
                  onReact={react}
                  onUnreact={unreact}
                  onOpenReplies={setReplyTarget}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {activeThread && (
            <MessageInput
              placeholder={`Message #${activeThread.name.toLowerCase()}`}
              onSend={sendMessage}
            />
          )}
        </main>

        {replyTarget && (
          <ReplyPanel
            parentMessage={replyTarget}
            currentUserId={currentUserId}
            canModerate={canModerate}
            onClose={() => setReplyTarget(null)}
            onEdit={editMessage}
            onDelete={deleteMessage}
            onReact={react}
            onUnreact={unreact}
          />
        )}
      </div>

      <CreateThreadModal
        open={showCreateThread}
        onClose={() => setShowCreateThread(false)}
        onCreate={createThread}
      />

      <Footer />
    </div>
  );
}
