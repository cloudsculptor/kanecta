import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import MessageItem from "../components/discussions/MessageItem";
import MentionInput from "../components/discussions/MentionInput";
import CreateThreadModal from "../components/discussions/CreateThreadModal";
import ReplyPanel from "../components/discussions/ReplyPanel";
import { useUserRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { useThreadSocket } from "../hooks/useSocket";
import { api, type Thread, type Message, type Reaction } from "../api/discussions";
import keycloak from "../auth/keycloak";

// ── Mobile back bar ───────────────────────────────────────────────────────────

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

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
  const [teamUsers, setTeamUsers] = useState<{ id: string; name: string }[]>([]);
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
    }).finally(() => setLoadingThreads(false));
    api.users.list().then(setTeamUsers).catch(() => {});
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
    const msg = data as Message;
    setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
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

  const handleReplyCount = useCallback((data: unknown) => {
    const { message_id } = data as { message_id: string };
    setMessages((prev) => prev.map((m) => m.id === message_id ? { ...m, reply_count: Number(m.reply_count) + 1 } : m));
  }, []);

  useThreadSocket(activeThreadId, {
    "message:new": handleNewMessage,
    "message:edit": handleEditMessage,
    "message:delete": handleDeleteMessage,
    "reaction:update": handleReactionUpdate,
    "thread:new": handleNewThread,
    "message:reply_count": handleReplyCount,
  });

  async function sendMessage(content: string) {
    if (!activeThreadId) return;
    const message = await api.messages.post(activeThreadId, content);
    setMessages((prev) => prev.some((m) => m.id === message.id) ? prev : [...prev, message]);
  }

  async function editMessage(id: string, content: string) {
    const updated = await api.messages.edit(id, content);
    setMessages((prev) => prev.map((m) => m.id === id ? updated : m));
  }

  async function deleteMessage(id: string) {
    await api.messages.delete(id);
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, deleted_at: new Date().toISOString(), content: "" } : m));
  }

  async function react(messageId: string, emoji: string) {
    const updated = await api.reactions.add(messageId, emoji);
    setReactions((prev) => ({ ...prev, [messageId]: updated }));
    return updated;
  }

  async function unreact(messageId: string, emoji: string) {
    const updated = await api.reactions.remove(messageId, emoji);
    setReactions((prev) => ({ ...prev, [messageId]: updated }));
    return updated;
  }

  async function createThread(name: string, description?: string) {
    await api.threads.create(name, description);
  }

  function selectThread(id: string) {
    setActiveThreadId(id);
    setReplyTarget(null);
  }

  function goBackToThreads() {
    setActiveThreadId(null);
    setReplyTarget(null);
  }

  if (role !== "TEAM" && role !== "MODERATOR") return null;

  const inThread = !!activeThreadId;
  const inReplies = !!replyTarget;

  return (
    <div className="discussions-page">
      <Header />

      <div className={`discussions-layout${inThread ? " discussions-layout--in-thread" : ""}${inReplies ? " discussions-layout--in-replies" : ""}`}>

        {/* ── Sidebar / Thread List ── */}
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
                    onClick={() => selectThread(t.id)}
                  >
                    <span className="discussions-thread-item__hash">#</span>
                    <span className="discussions-thread-item__content">
                      <span className="discussions-thread-item__name">{t.name}</span>
                      {t.description && (
                        <span className="discussions-thread-item__preview">{t.description}</span>
                      )}
                    </span>
                    <span className="discussions-thread-item__chevron">›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ── Messages Panel ── */}
        <main className="discussions-main">
          {/* Mobile back bar — hidden on desktop via CSS */}
          <div className="discussions-main__mobile-bar">
            <button className="discussions-main__back" onClick={goBackToThreads}>
              <BackArrow />
              <span>Threads</span>
            </button>
            <span className="discussions-main__mobile-title">
              {activeThread ? `# ${activeThread.name}` : ""}
            </span>
            <button className="discussions-main__mobile-new" onClick={() => setShowCreateThread(true)} aria-label="New thread">+</button>
          </div>

          {/* Desktop header — hidden on mobile via CSS */}
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
            {!activeThreadId ? (
              <div className="discussions-messages__empty">Select a thread to start chatting.</div>
            ) : loadingMessages ? (
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
            <MentionInput
              placeholder={`Message #${activeThread.name.toLowerCase()}`}
              onSend={sendMessage}
              users={teamUsers}
            />
          )}
        </main>

        {/* ── Reply Panel ── */}
        {replyTarget && (
          <ReplyPanel
            parentMessage={replyTarget}
            currentUserId={currentUserId}
            canModerate={canModerate}
            users={teamUsers}
            onClose={() => setReplyTarget(null)}
            onReplied={(messageId) =>
              setMessages((prev) =>
                prev.map((m) => m.id === messageId ? { ...m, reply_count: Number(m.reply_count) + 1 } : m)
              )
            }
            onEdit={editMessage}
            onDelete={deleteMessage}
            onReact={react}
            onUnreact={unreact}
          />
        )}
      </div>

      <Footer />

      <CreateThreadModal
        open={showCreateThread}
        onClose={() => setShowCreateThread(false)}
        onCreate={createThread}
      />
    </div>
  );
}
