import { useState, useEffect } from "react";
import { api, type UnreadThread, type Message } from "../../api/discussions";
import { parseContent } from "./MentionInput";

interface Props {
  onMarkRead: (threadId: string) => void;
  onJumpToThread: (threadId: string) => void;
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
    <div className={`unreads-message${muted ? " unreads-message--context" : ""}`}>
      <div className="unreads-message__avatar">{avatar(message.user_name)}</div>
      <div className="unreads-message__body">
        <div className="unreads-message__meta">
          <span className="unreads-message__author">{message.user_name}</span>
          <span className="unreads-message__time">{formatTime(message.created_at)}</span>
          {muted && <span className="unreads-message__context-label">original message</span>}
          {message.edited_at && <span className="unreads-message__edited">(edited)</span>}
        </div>
        <p className="unreads-message__text">
          {parseContent(message.content).map((seg, i) => {
            if (seg.type === "mention")
              return <span key={i} className="discussions-mention-pill">@{seg.value}</span>;
            if (seg.type === "url")
              return <a key={i} href={seg.value} target="_blank" rel="noopener noreferrer" className="discussions-message__link">{seg.value}</a>;
            return <span key={i}>{seg.value}</span>;
          })}
        </p>
        {!muted && message.reply_count > 0 && (
          <span className="unreads-message__replies">{message.reply_count} {message.reply_count === 1 ? "reply" : "replies"}</span>
        )}
      </div>
    </div>
  );
}

function MessageGroupBlock({ group }: { group: MessageGroup }) {
  return (
    <div className="unreads-group">
      <UnreadMessage message={group.parent} muted={group.isContext} />
      {group.replies.length > 0 && (
        <div className="unreads-group__replies">
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
    <div className="unreads-thread">
      <div className="unreads-thread__header">
        <button className="unreads-thread__name" onClick={onJumpToThread}>
          <span className="unreads-thread__hash">#</span>{unread.name}
        </button>
        <button className="unreads-thread__mark-read" onClick={handleMarkRead} disabled={marking}>
          {marking ? "Marking…" : "Mark as Read"}
        </button>
      </div>
      <div className="unreads-thread__messages">
        {groups.map((g) => <MessageGroupBlock key={g.parent.id} group={g} />)}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UnreadsView({ onMarkRead, onJumpToThread }: Props) {
  const [unreads, setUnreads] = useState<UnreadThread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.reads.list().then(setUnreads).finally(() => setLoading(false));
  }, []);

  function handleMarkRead(threadId: string) {
    setUnreads((prev) => prev.filter((u) => u.thread_id !== threadId));
    onMarkRead(threadId);
  }

  return (
    <div className="unreads-view">
      <div className="unreads-view__header">
        <h1 className="unreads-view__title">All Unreads</h1>
        {!loading && unreads.length > 0 && (
          <button
            className="unreads-view__mark-all"
            onClick={async () => {
              await Promise.all(unreads.map((u) => api.reads.mark(u.thread_id).catch(() => {})));
              unreads.forEach((u) => onMarkRead(u.thread_id));
              setUnreads([]);
            }}
          >
            Mark all as read
          </button>
        )}
      </div>

      {loading ? (
        <div className="unreads-view__empty">Loading…</div>
      ) : unreads.length === 0 ? (
        <div className="unreads-view__empty">
          <div className="unreads-view__empty-icon">✓</div>
          You're all caught up!
        </div>
      ) : (
        unreads.map((u) => (
          <UnreadThreadSection
            key={u.thread_id}
            unread={u}
            onMarkRead={() => handleMarkRead(u.thread_id)}
            onJumpToThread={() => onJumpToThread(u.thread_id)}
          />
        ))
      )}
    </div>
  );
}
