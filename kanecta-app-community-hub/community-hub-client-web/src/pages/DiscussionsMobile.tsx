import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import MobileMessageItem from "../components/discussions/MobileMessageItem";
import MentionInput from "../components/discussions/MentionInput";
import CreateThreadModal from "../components/discussions/CreateThreadModal";
import ThreadOptionsMenu from "../components/discussions/ThreadOptionsMenu";
import CopyLinkButton from "../components/discussions/CopyLinkButton";
import { useKeycloak } from "../auth/KeycloakProvider";
import { useUserRole } from "../auth/useUserRole";
import { useThreadSocket, useRepliesSocket, useGlobalSocket } from "../hooks/useSocket";
import MobileUnreads from "../components/discussions/MobileUnreads";
import { api, type Thread, type Message, type Reaction } from "../api/discussions";
import keycloak from "../auth/keycloak";

// ── Icons ─────────────────────────────────────────────────────────────────────

const BackArrow = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

// ── Thread list screen ────────────────────────────────────────────────────────

function ThreadsScreen({
  threads, loading, onSelect, onNew, onBack, onShowUnreads,
}: {
  threads: Thread[];
  loading: boolean;
  onSelect: (t: Thread) => void;
  onNew: () => void;
  onBack: () => void;
  onShowUnreads: () => void;
}) {
  const unreadCount = threads.filter((t) => t.has_unread).length;

  return (
    <div className="dm-screen dm-threads">
      <div className="dm-bar">
        <button className="dm-bar__back dm-bar__back--white" onClick={onBack} aria-label="Back to home"><BackArrow /></button>
        <span className="dm-bar__title">Discussions</span>
        <button className="dm-bar__action" onClick={onNew} aria-label="New thread">+</button>
      </div>

      {loading ? (
        <div className="dm-empty">Loading…</div>
      ) : (
        <div className="dm-thread-list">
          {/* All Unreads nav item */}
          <div className="dm-nav-section">
            <button className="dm-nav-item" onClick={onShowUnreads}>
              <svg className="dm-nav-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                <line x1="9" y1="10" x2="15" y2="10" />
                <line x1="9" y1="14" x2="13" y2="14" />
              </svg>
              All Unreads
              {unreadCount > 0 && (
                <span className="dm-nav-item__badge">{unreadCount}</span>
              )}
              <span className="dm-nav-item__chevron">›</span>
            </button>
          </div>

          {threads.length === 0 ? (
            <div className="dm-empty">No threads yet. Tap + to create one.</div>
          ) : (
            <>
              <div className="dm-section-label">Threads</div>
              <ul className="dm-thread-sublist">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button className={`dm-thread-item${t.has_unread ? " dm-thread-item--unread" : ""}`} onClick={() => onSelect(t)}>
                      <span className="dm-thread-item__hash">#</span>
                      <span className="dm-thread-item__body">
                        <span className="dm-thread-item__name">{t.name}</span>
                        {t.description && <span className="dm-thread-item__preview">{t.description}</span>}
                      </span>
                      <span className="dm-thread-item__chevron">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Messages screen ───────────────────────────────────────────────────────────

function MessagesScreen({
  thread, messages, loading, reactions, currentUserId, canModerate, users,
  onBack, onSend, onEdit, onDelete, onReact, onUnreact, onOpenReplies, onArchived,
}: {
  thread: Thread;
  messages: Message[];
  loading: boolean;
  reactions: Record<string, Reaction[]>;
  currentUserId: string;
  canModerate: boolean;
  users: { id: string; name: string }[];
  onBack: () => void;
  onSend: (content: string) => Promise<void>;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReact: (id: string, emoji: string) => Promise<unknown>;
  onUnreact: (id: string, emoji: string) => Promise<unknown>;
  onOpenReplies: (msg: Message) => void;
  onArchived: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length > 0) endRef.current?.scrollIntoView();
  }, [messages]);

  return (
    <div className="dm-screen dm-messages">
      <div className="dm-bar dm-bar--left">
        <button className="dm-bar__back" onClick={onBack}><BackArrow /></button>
        <span className="dm-bar__thread-name"># {thread.name}</span>
        <div className="discussions-header-actions">
          <CopyLinkButton />
          <ThreadOptionsMenu
            thread={thread}
            currentUserId={currentUserId}
            canModerate={canModerate}
            onArchived={onArchived}
          />
        </div>
      </div>
      <div className="dm-message-list">
        {loading ? (
          <div className="dm-empty">Loading messages…</div>
        ) : messages.length === 0 ? (
          <div className="dm-empty">No messages yet. Say hello!</div>
        ) : (
          messages.map((msg) => (
            <MobileMessageItem
              key={msg.id}
              message={msg}
              reactions={reactions[msg.id] || []}
              currentUserId={currentUserId}
              canModerate={canModerate}
              onEdit={onEdit}
              onDelete={onDelete}
              onReact={onReact}
              onUnreact={onUnreact}
              onOpenReplies={onOpenReplies}
            />
          ))
        )}
        <div ref={endRef} />
      </div>
      <MentionInput
        placeholder={`Message #${thread.name.toLowerCase()}`}
        onSend={onSend}
        users={users}
      />
    </div>
  );
}

// ── Replies screen ────────────────────────────────────────────────────────────

function RepliesScreen({
  parentMessage, currentUserId, canModerate, users,
  onBack, onEdit, onDelete, onReact, onUnreact, onReplied,
}: {
  parentMessage: Message;
  currentUserId: string;
  canModerate: boolean;
  users: { id: string; name: string }[];
  onBack: () => void;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReact: (id: string, emoji: string) => Promise<unknown>;
  onUnreact: (id: string, emoji: string) => Promise<unknown>;
  onReplied: (messageId: string) => void;
}) {
  const [replies, setReplies] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [loading, setLoading] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.messages.replies(parentMessage.id),
      api.reactions.listForThread(parentMessage.thread_id),
    ]).then(([msgs, rxns]) => {
      setReplies(msgs);
      setReactions(rxns);
    }).finally(() => setLoading(false));
  }, [parentMessage.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [replies]);

  useRepliesSocket(parentMessage.id, {
    "reply:new": (data) => {
      const r = data as Message;
      setReplies((prev) => prev.some((m) => m.id === r.id) ? prev : [...prev, r]);
    },
  });

  async function sendReply(content: string) {
    const reply = await api.messages.reply(parentMessage.id, content);
    setReplies((prev) => prev.some((r) => r.id === reply.id) ? prev : [...prev, reply]);
    onReplied(parentMessage.id);
  }

  return (
    <div className="dm-screen dm-replies">
      <div className="dm-bar">
        <button className="dm-bar__back" onClick={onBack}><BackArrow /></button>
        <span className="dm-bar__title">Thread</span>
        <span className="dm-bar__action" />
      </div>

      <div className="dm-message-list">
        {/* Original message scrolls with replies */}
        <div className="dm-replies__parent">
          <MobileMessageItem
            message={parentMessage}
            reactions={[]}
            currentUserId={currentUserId}
            canModerate={canModerate}
            onEdit={onEdit}
            onDelete={onDelete}
            onReact={onReact}
            onUnreact={onUnreact}
            onOpenReplies={() => {}}
          />
        </div>
        {loading ? (
          <div className="dm-empty">Loading…</div>
        ) : replies.length === 0 ? (
          <div className="dm-empty">No replies yet.</div>
        ) : (
          replies.map((r) => (
            <MobileMessageItem
              key={r.id}
              message={r}
              reactions={reactions[r.id] || []}
              currentUserId={currentUserId}
              canModerate={canModerate}
              onEdit={async (id, content) => {
                await onEdit(id, content);
                setReplies((prev) => prev.map((m) => m.id === id ? { ...m, content } : m));
              }}
              onDelete={async (id) => {
                await onDelete(id);
                setReplies((prev) => prev.map((m) => m.id === id ? { ...m, deleted_at: new Date().toISOString(), content: "" } : m));
              }}
              onReact={async (id, emoji) => {
                const updated = await onReact(id, emoji);
                if (Array.isArray(updated)) setReactions((prev) => ({ ...prev, [id]: updated as Reaction[] }));
              }}
              onUnreact={async (id, emoji) => {
                const updated = await onUnreact(id, emoji);
                if (Array.isArray(updated)) setReactions((prev) => ({ ...prev, [id]: updated as Reaction[] }));
              }}
              onOpenReplies={() => {}}
            />
          ))
        )}
        <div ref={endRef} />
      </div>

      <MentionInput placeholder="Reply…" onSend={sendReply} users={users} />
    </div>
  );
}

// ── Root mobile component ─────────────────────────────────────────────────────

export default function DiscussionsMobile() {
  const navigate = useNavigate();
  const { authenticated } = useKeycloak();
  const role = useUserRole();

  const [threads, setThreads] = useState<Thread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({});
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [showCreateThread, setShowCreateThread] = useState(false);
  const [showUnreads, setShowUnreads] = useState(false);
  const [teamUsers, setTeamUsers] = useState<{ id: string; name: string }[]>([]);

  const currentUserId = keycloak.tokenParsed?.sub || "";
  const canModerate = role === "MODERATOR";

  useEffect(() => {
    if (!authenticated) return;
    api.threads.list().then((data) => {
      setThreads(data);
      const hashId = window.location.hash.slice(1);
      const initial = data.find((t) => t.id === hashId);
      if (initial) setActiveThread(initial);
    }).finally(() => setLoadingThreads(false));
    api.users.list().then(setTeamUsers).catch(() => {});
  }, [authenticated]);

  useEffect(() => {
    window.history.replaceState(
      null, "",
      activeThread ? `#${activeThread.id}` : window.location.pathname,
    );
  }, [activeThread?.id]);

  useEffect(() => {
    if (!activeThread) return;
    setLoadingMessages(true);
    setMessages([]);
    setReactions({});
    Promise.all([
      api.messages.list(activeThread.id),
      api.reactions.listForThread(activeThread.id),
    ]).then(([msgs, rxns]) => {
      setMessages(msgs);
      setReactions(rxns);
      api.reads.mark(activeThread.id).catch(() => {});
      setThreads((prev) => prev.map((t) => t.id === activeThread.id ? { ...t, has_unread: false } : t));
    }).finally(() => setLoadingMessages(false));
  }, [activeThread?.id]);

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

  const handleThreadArchived = useCallback((id: string) => {
    setThreads((prev) => prev.filter((t) => t.id !== id));
    setActiveThread((cur) => (cur?.id === id ? null : cur));
    setReplyTarget(null);
  }, []);

  const activeThreadRef = useRef(activeThread);
  activeThreadRef.current = activeThread;

  useGlobalSocket({
    "thread:activity": useCallback((data: unknown) => {
      const { thread_id } = data as { thread_id: string };
      if (thread_id === activeThreadRef.current?.id) {
        api.reads.mark(thread_id).catch(() => {});
      } else {
        setThreads((prev) => prev.map((t) => t.id === thread_id ? { ...t, has_unread: true } : t));
      }
    }, []),
  });

  useThreadSocket(activeThread?.id ?? null, {
    "message:new": handleNewMessage,
    "message:edit": handleEditMessage,
    "message:delete": handleDeleteMessage,
    "reaction:update": handleReactionUpdate,
    "thread:new": handleNewThread,
    "message:reply_count": handleReplyCount,
    "thread:archived": (data) => handleThreadArchived((data as { id: string }).id),
  });

  async function sendMessage(content: string) {
    if (!activeThread) return;
    const msg = await api.messages.post(activeThread.id, content);
    setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
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
    const t = await api.threads.create(name, description);
    setActiveThread(t);
  }

  if (showUnreads) {
    return (
      <MobileUnreads
        onBack={() => setShowUnreads(false)}
        onMarkRead={(threadId) =>
          setThreads((prev) => prev.map((t) => t.id === threadId ? { ...t, has_unread: false } : t))
        }
        onJumpToThread={(threadId) => {
          const t = threads.find((x) => x.id === threadId);
          if (t) setActiveThread(t);
          setShowUnreads(false);
        }}
      />
    );
  }

  if (replyTarget && activeThread) {
    return (
      <>
<RepliesScreen
          parentMessage={replyTarget}
          currentUserId={currentUserId}
          canModerate={canModerate}
          users={teamUsers}
          onBack={() => setReplyTarget(null)}
          onEdit={editMessage}
          onDelete={deleteMessage}
          onReact={react}
          onUnreact={unreact}
          onReplied={(messageId) =>
            setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reply_count: Number(m.reply_count) + 1 } : m))
          }
        />
        <CreateThreadModal open={showCreateThread} onClose={() => setShowCreateThread(false)} onCreate={createThread} onGoToThread={(id) => { const t = threads.find((x) => x.id === id); if (t) setActiveThread(t); setShowCreateThread(false); }} />
      </>
    );
  }

  if (activeThread) {
    return (
      <>
<MessagesScreen
          thread={activeThread}
          messages={messages}
          loading={loadingMessages}
          reactions={reactions}
          currentUserId={currentUserId}
          canModerate={canModerate}
          users={teamUsers}
          onBack={() => { setActiveThread(null); setReplyTarget(null); }}
          onSend={sendMessage}
          onEdit={editMessage}
          onDelete={deleteMessage}
          onReact={react}
          onUnreact={unreact}
          onOpenReplies={setReplyTarget}
          onArchived={() => handleThreadArchived(activeThread.id)}
        />
        <CreateThreadModal open={showCreateThread} onClose={() => setShowCreateThread(false)} onCreate={createThread} onGoToThread={(id) => { const t = threads.find((x) => x.id === id); if (t) setActiveThread(t); setShowCreateThread(false); }} />
      </>
    );
  }

  return (
    <>
      <ThreadsScreen
        threads={threads}
        loading={loadingThreads}
        onSelect={setActiveThread}
        onNew={() => setShowCreateThread(true)}
        onBack={() => navigate("/")}
        onShowUnreads={() => setShowUnreads(true)}
      />
      <CreateThreadModal open={showCreateThread} onClose={() => setShowCreateThread(false)} onCreate={createThread} onGoToThread={(id) => { const t = threads.find((x) => x.id === id); if (t) setActiveThread(t); setShowCreateThread(false); }} />
    </>
  );
}
