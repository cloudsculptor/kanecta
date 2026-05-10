import { useState, useEffect } from "react";
import { api, type UnreadThread, type Message } from "../../api/discussions";
import { parseContent } from "./MentionInput";

interface Props {
  onBack: () => void;
  onJumpToThread: (threadId: string) => void;
  onMarkRead: (threadId: string) => void;
}

interface MessageGroup {
  parent: Message;
  isContext: boolean;
  replies: Message[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function avatar(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" });
}

function buildGroups(messages: Message[], lastReadAt: string): MessageGroup[] {
  const topLevel = messages.filter((m) => !m.parent_message_id);
  const replies = messages.filter((m) => m.parent_message_id);
  return topLevel
    .map((parent) => ({
      parent,
      isContext: parent.created_at <= lastReadAt,
      replies: replies.filter((r) => r.parent_message_id === parent.id),
    }))
    .filter((g) => !g.isContext || g.replies.length > 0);
}

// ── Message rendering ─────────────────────────────────────────────────────────

function UnreadMessage({ message, muted = false }: { message: Message; muted?: boolean }) {
  if (message.deleted_at) return null;
  return (
    <div className={`unreads-screen__message${muted ? " unreads-screen__message--context" : ""}`}>
      <div className="unreads-screen__message-avatar">{avatar(message.user_name)}</div>
      <div className="unreads-screen__message-body">
        <div className="unreads-screen__message-meta">
          <span className="unreads-screen__message-author">{message.user_name}</span>
          <span className="unreads-screen__message-time">{formatTime(message.created_at)}</span>
          {muted && <span className="unreads-screen__context-label">original message</span>}
        </div>
        <p className="unreads-screen__message-text">
          {parseContent(message.content).map((seg, i) => {
            if (seg.type === "mention")
              return <span key={i} className="discussions-mention-pill">@{seg.value}</span>;
            if (seg.type === "url")
              return <a key={i} href={seg.value} target="_blank" rel="noopener noreferrer" className="discussions-message__link">{seg.value}</a>;
            return <span key={i}>{seg.value}</span>;
          })}
        </p>
        {!muted && message.reply_count > 0 && (
          <span className="unreads-screen__message-replies">
            {message.reply_count} {message.reply_count === 1 ? "reply" : "replies"}
          </span>
        )}
      </div>
    </div>
  );
}

function MessageGroupBlock({ group }: { group: MessageGroup }) {
  return (
    <div className="unreads-screen__group">
      <UnreadMessage message={group.parent} muted={group.isContext} />
      {group.replies.length > 0 && (
        <div className="unreads-screen__group-replies">
          {group.replies.map((r) => (
            <UnreadMessage key={r.id} message={r} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Thread section ────────────────────────────────────────────────────────────

function UnreadThreadSection({
  unread, onMarkRead, onJumpToThread,
}: {
  unread: UnreadThread;
  onMarkRead: () => void;
  onJumpToThread: () => void;
}) {
  const [marking, setMarking] = useState(false);
  const groups = buildGroups(unread.messages, unread.last_read_at);

  async function handleMarkRead() {
    setMarking(true);
    await api.reads.mark(unread.thread_id).catch(() => {});
    onMarkRead();
  }

  return (
    <div className="unreads-screen__thread">
      <div className="unreads-screen__thread-header">
        <button className="unreads-screen__thread-name" onClick={onJumpToThread}>
          <span className="unreads-screen__thread-hash">#</span>
          {unread.name}
        </button>
        <button className="unreads-screen__thread-mark-read" onClick={handleMarkRead} disabled={marking}>
          {marking ? "Marking…" : "Mark as Read"}
        </button>
      </div>
      <div className="unreads-screen__thread-messages">
        {groups.map((g) => <MessageGroupBlock key={g.parent.id} group={g} />)}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MobileUnreads({ onBack, onJumpToThread, onMarkRead }: Props) {
  const [unreads, setUnreads] = useState<UnreadThread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.reads.list().then(setUnreads).finally(() => setLoading(false));
  }, []);

  function handleMarkRead(threadId: string) {
    setUnreads((prev) => prev.filter((u) => u.thread_id !== threadId));
    onMarkRead(threadId);
  }

  async function handleMarkAll() {
    await Promise.all(unreads.map((u) => api.reads.mark(u.thread_id).catch(() => {})));
    unreads.forEach((u) => onMarkRead(u.thread_id));
    setUnreads([]);
  }

  return (
    <div className="unreads-screen dm-screen">
      <div className="dm-bar">
        <button className="dm-bar__back" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <span className="dm-bar__title">All Unreads</span>
        {!loading && unreads.length > 0 ? (
          <button className="dm-bar__action unreads-screen__mark-all" onClick={handleMarkAll}>
            All read
          </button>
        ) : (
          <span className="dm-bar__action" />
        )}
      </div>

      {loading ? (
        <div className="dm-empty">Loading…</div>
      ) : unreads.length === 0 ? (
        <div className="unreads-screen__empty">
          <div className="unreads-screen__empty-icon">✓</div>
          You're all caught up!
        </div>
      ) : (
        <div className="unreads-screen__content">
          {unreads.map((u) => (
            <UnreadThreadSection
              key={u.thread_id}
              unread={u}
              onMarkRead={() => handleMarkRead(u.thread_id)}
              onJumpToThread={() => onJumpToThread(u.thread_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
