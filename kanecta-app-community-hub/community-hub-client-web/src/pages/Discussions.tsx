import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMobile } from "../hooks/useMobile";
import DiscussionsMobile from "./DiscussionsMobile";
import Header from "../components/Header";
import MessageItem from "../components/discussions/MessageItem";
import MentionInput from "../components/discussions/MentionInput";
import CreateThreadModal from "../components/discussions/CreateThreadModal";
import ReplyPanel from "../components/discussions/ReplyPanel";
import UnreadsView from "../components/discussions/UnreadsView";
import ThreadOptionsMenu from "../components/discussions/ThreadOptionsMenu";
import CopyLinkButton from "../components/discussions/CopyLinkButton";
import { useUserRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { useThreadSocket, useGlobalSocket } from "../hooks/useSocket";
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
  const isMobile = useMobile();
  const role = useUserRole();
  const { authenticated, initialized } = useKeycloak();
  const navigate = useNavigate();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [showCreateThread, setShowCreateThread] = useState(false);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [showUnreads, setShowUnreads] = useState(false);
  const [teamUsers, setTeamUsers] = useState<{ id: string; name: string }[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const currentUserId = keycloak.tokenParsed?.sub || "";
  const canModerate = role === "MODERATOR";

  useEffect(() => {
    if (!initialized) return;
    if (role === "PUBLIC") navigate("/", { replace: true });
    else if (role === "GUEST" || role === "RESILIENCE") navigate("/discussions/team-required", { replace: true });
  }, [initialized, role, navigate]);

  useEffect(() => {
    if (!authenticated) return;
    api.threads.list().then((data) => {
      setThreads(data);
      const hashId = window.location.hash.slice(1);
      const initial = data.find((t) => t.id === hashId) ?? data[0] ?? null;
      setActiveThreadId(initial?.id ?? null);
    }).finally(() => setLoadingThreads(false));
    api.users.list().then(setTeamUsers).catch(() => {});
  }, [authenticated]);

  useEffect(() => {
    window.history.replaceState(
      null, "",
      activeThreadId ? `#${activeThreadId}` : window.location.pathname,
    );
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) return;
    setLoadingMessages(true);
    setMessages([]);
    setReactions({});
    Promise.all([
      api.messages.list(activeThreadId),
      api.reactions.listForThread(activeThreadId),
    ]).then(([msgs, rxns]) => {
      setMessages(msgs);
      setReactions(rxns);
      api.reads.mark(activeThreadId).catch(() => {});
      setThreads((prev) => prev.map((t) => t.id === activeThreadId ? { ...t, has_unread: false } : t));
    }).finally(() => setLoadingMessages(false));
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
    setThreads((prev) => [...prev, { ...(data as Thread), has_unread: false }]);
  }, []);

  const handleReplyCount = useCallback((data: unknown) => {
    const { message_id } = data as { message_id: string };
    setMessages((prev) => prev.map((m) => m.id === message_id ? { ...m, reply_count: Number(m.reply_count) + 1 } : m));
  }, []);

  const handleThreadArchived = useCallback((data: unknown) => {
    const { id } = data as { id: string };
    setThreads((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      setActiveThreadId((cur) => {
        if (cur === id) return remaining.length > 0 ? remaining[0].id : null;
        return cur;
      });
      return remaining;
    });
  }, []);

  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

  useGlobalSocket({
    "thread:activity": useCallback((data: unknown) => {
      const { thread_id } = data as { thread_id: string };
      if (thread_id === activeThreadIdRef.current) {
        api.reads.mark(thread_id).catch(() => {});
      } else {
        setThreads((prev) => prev.map((t) => t.id === thread_id ? { ...t, has_unread: true } : t));
      }
    }, []),
  });

  useThreadSocket(activeThreadId, {
    "message:new": handleNewMessage,
    "message:edit": handleEditMessage,
    "message:delete": handleDeleteMessage,
    "reaction:update": handleReactionUpdate,
    "thread:new": handleNewThread,
    "message:reply_count": handleReplyCount,
    "thread:archived": handleThreadArchived,
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
    setShowUnreads(false);
  }

  function goBackToThreads() {
    setActiveThreadId(null);
    setReplyTarget(null);
  }

  if (role !== "TEAM" && role !== "MODERATOR") return null;
  if (isMobile) return <DiscussionsMobile />;

  const inThread = !!activeThreadId;
  const inReplies = !!replyTarget;

  return (
    <div className="discussions-page">
      <Header />


<div className={`discussions-layout${inThread ? " discussions-layout--in-thread" : ""}${inReplies ? " discussions-layout--in-replies" : ""}`}>

        {/* ── Sidebar / Thread List ── */}
        <aside className="discussions-sidebar">
          {/* All Unreads nav item */}
          <div className="discussions-sidebar__nav-section">
            <button
              className={`discussions-nav-item${showUnreads ? " discussions-nav-item--active" : ""}`}
              onClick={() => { setShowUnreads(true); setActiveThreadId(null); setReplyTarget(null); }}
            >
              <svg className="discussions-nav-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                <line x1="9" y1="10" x2="15" y2="10" />
                <line x1="9" y1="14" x2="13" y2="14" />
              </svg>
              All Unreads
              {threads.filter((t) => t.has_unread).length > 0 && (
                <span className="discussions-nav-item__badge">
                  {threads.filter((t) => t.has_unread).length}
                </span>
              )}
            </button>
          </div>

          {/* Thread list */}
          {loadingThreads ? (
            <div className="discussions-sidebar__loading">Loading…</div>
          ) : threads.length === 0 ? (
            <>
              <div className="discussions-sidebar__heading">
                Threads
                <button className="discussions-sidebar__new" onClick={() => setShowCreateThread(true)} title="New thread">+</button>
              </div>
              <div className="discussions-sidebar__empty">No threads yet. Create one!</div>
            </>
          ) : (
            <>
              <div className="discussions-sidebar__heading">
                Threads
                <button className="discussions-sidebar__new" onClick={() => setShowCreateThread(true)} title="New thread">+</button>
              </div>
              <ul className="discussions-sidebar__list">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button
                      className={`discussions-thread-item${t.has_unread ? " discussions-thread-item--unread" : ""}${t.id === activeThreadId && !showUnreads ? " discussions-thread-item--active" : ""}`}
                      onClick={() => selectThread(t.id)}
                    >
                      <span className="discussions-thread-item__hash">#</span>
                      <span className="discussions-thread-item__content">
                        <span className="discussions-thread-item__name">{t.name}</span>
                        {t.description && (
                          <span className="discussions-thread-item__preview">{t.description}</span>
                        )}
                      </span>
                      {t.has_unread && t.id !== activeThreadId && <span className="discussions-thread-item__dot" />}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        {/* ── Messages Panel ── */}
        <main className={`discussions-main${showUnreads ? " discussions-main--unreads" : ""}`}>
          {showUnreads ? (
            <UnreadsView
              onMarkRead={(threadId) =>
                setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, has_unread: false } : t))
              }
              onJumpToThread={(threadId) => selectThread(threadId)}
            />
          ) : (
          <>

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
              <div className="discussions-header-actions">
                <CopyLinkButton />
                <ThreadOptionsMenu
                  thread={activeThread}
                  currentUserId={currentUserId}
                  canModerate={canModerate}
                  onArchived={() => handleThreadArchived({ id: activeThread.id })}
                />
              </div>
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
          </>
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

      <CreateThreadModal
        open={showCreateThread}
        onClose={() => setShowCreateThread(false)}
        onCreate={createThread}
        onGoToThread={(id) => { selectThread(id); setShowCreateThread(false); }}
      />
    </div>
  );
}
