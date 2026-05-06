import { useState, useEffect, useRef } from "react";
import { useRepliesSocket } from "../../hooks/useSocket";
import { api, type Message, type Reaction, type User } from "../../api/discussions";
import MessageItem from "./MessageItem";
import MentionInput from "./MentionInput";

interface Props {
  parentMessage: Message;
  currentUserId: string;
  canModerate: boolean;
  users: User[];
  onClose: () => void;
  onReplied: (messageId: string) => void;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReact: (id: string, emoji: string) => Promise<unknown>;
  onUnreact: (id: string, emoji: string) => Promise<unknown>;
}

export default function ReplyPanel({
  parentMessage, currentUserId, canModerate, users,
  onClose, onReplied, onEdit, onDelete, onReact, onUnreact,
}: Props) {
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
  }, [parentMessage.id, parentMessage.thread_id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [replies]);

  useRepliesSocket(parentMessage.id, {
    "reply:new": (data) => {
      const reply = data as Message;
      setReplies((prev) => prev.some((r) => r.id === reply.id) ? prev : [...prev, reply]);
    },
  });

  async function sendReply(content: string) {
    const reply = await api.messages.reply(parentMessage.id, content);
    setReplies((prev) => prev.some((r) => r.id === reply.id) ? prev : [...prev, reply]);
    onReplied(parentMessage.id);
  }

  async function editReply(id: string, content: string) {
    const updated = await onEdit(id, content);
    setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, content } : r)));
    return updated;
  }

  async function deleteReply(id: string) {
    await onDelete(id);
    setReplies((prev) => prev.map((r) => r.id === id ? { ...r, deleted_at: new Date().toISOString(), content: "" } : r));
  }

  return (
    <div className="discussions-reply-panel">
      <div className="discussions-reply-panel__header">
        {/* Mobile: back arrow; Desktop: close × */}
        <button className="discussions-reply-panel__back" onClick={onClose} aria-label="Back">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="discussions-reply-panel__back-label">Back</span>
        </button>
        <span>Thread</span>
        <button className="discussions-reply-panel__close" onClick={onClose} aria-label="Close thread">×</button>
      </div>

      <div className="discussions-reply-panel__replies">
        <div className="discussions-reply-panel__parent">
          <MessageItem
            message={parentMessage}
            reactions={reactions[parentMessage.id] || []}
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
          <div className="discussions-reply-panel__loading">Loading replies…</div>
        ) : replies.length === 0 ? (
          <div className="discussions-reply-panel__empty">No replies yet. Start the thread!</div>
        ) : (
          <>
          <div className="discussions-reply-panel__divider">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </div>
          {replies.map((r) => (
            <MessageItem
              key={r.id}
              message={r}
              reactions={reactions[r.id] || []}
              currentUserId={currentUserId}
              canModerate={canModerate}
              onEdit={editReply}
              onDelete={deleteReply}
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
          ))}
          </>
        )}
        <div ref={endRef} />
      </div>

      <MentionInput
        placeholder="Reply…"
        onSend={sendReply}
        users={users}
      />
    </div>
  );
}
