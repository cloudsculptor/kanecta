import { useState } from "react";
import type { Message, Reaction } from "../../api/discussions";
import EmojiPicker from "./EmojiPicker";
import { parseMentions } from "./MentionInput";

interface Props {
  message: Message;
  reactions: Reaction[];
  currentUserId: string;
  canModerate: boolean;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReact: (id: string, emoji: string) => Promise<unknown>;
  onUnreact: (id: string, emoji: string) => Promise<unknown>;
  onOpenReplies: (message: Message) => void;
}

function avatar(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" });
}

export default function MessageItem({
  message, reactions, currentUserId, canModerate,
  onEdit, onDelete, onReact, onUnreact, onOpenReplies,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [showEmoji, setShowEmoji] = useState(false);
  const isOwn = message.user_id === currentUserId;
  const isDeleted = !!message.deleted_at;

  async function saveEdit() {
    if (editValue.trim() === message.content) { setEditing(false); return; }
    await onEdit(message.id, editValue.trim());
    setEditing(false);
  }

  if (isDeleted) {
    return (
      <div className="discussions-message discussions-message--deleted">
        <div className="discussions-message__avatar discussions-message__avatar--deleted">—</div>
        <div className="discussions-message__body">
          <p className="discussions-message__deleted-text">This message was deleted</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`discussions-message${hovered ? " discussions-message--hovered" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="discussions-message__avatar">{avatar(message.user_name)}</div>
      <div className="discussions-message__body">
        <div className="discussions-message__meta">
          <span className="discussions-message__author">{message.user_name}</span>
          <span className="discussions-message__time">{formatTime(message.created_at)}</span>
          {message.edited_at && <span className="discussions-message__edited">(edited)</span>}
        </div>

        {editing ? (
          <div className="discussions-message__edit">
            <textarea
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                if (e.key === "Escape") setEditing(false);
              }}
              className="discussions-message__edit-input"
            />
            <div className="discussions-message__edit-actions">
              <button onClick={saveEdit}>Save</button>
              <button onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <p className="discussions-message__text">
            {parseMentions(message.content).map((seg, i) =>
              seg.type === "mention"
                ? <span key={i} className="discussions-mention-pill">@{seg.value}</span>
                : <span key={i}>{seg.value}</span>
            )}
          </p>
        )}

        {reactions.length > 0 && (
          <div className="discussions-message__reactions">
            {reactions.map((r) => {
              const reacted = r.user_ids.includes(currentUserId);
              return (
                <button
                  key={r.emoji}
                  className={`discussions-reaction${reacted ? " discussions-reaction--own" : ""}`}
                  onClick={() => reacted ? onUnreact(message.id, r.emoji) : onReact(message.id, r.emoji)}
                  title={`${r.count} reaction${Number(r.count) !== 1 ? "s" : ""}`}
                >
                  {r.emoji} {r.count}
                </button>
              );
            })}
          </div>
        )}

        {message.reply_count > 0 && !editing && (
          <button className="discussions-message__reply-link" onClick={() => onOpenReplies(message)}>
            {message.reply_count} {message.reply_count === 1 ? "reply" : "replies"}
          </button>
        )}
      </div>

      {hovered && !editing && (
        <div className="discussions-message__actions">
          <div style={{ position: "relative" }}>
            <button title="React" onClick={() => setShowEmoji((v) => !v)}>😊</button>
            {showEmoji && (
              <EmojiPicker
                onSelect={(emoji) => onReact(message.id, emoji)}
                onClose={() => setShowEmoji(false)}
              />
            )}
          </div>
          <button title="Reply in thread" onClick={() => onOpenReplies(message)}>💬</button>
          {isOwn && (
            <button title="Edit" onClick={() => { setEditing(true); setEditValue(message.content); }}>✏️</button>
          )}
          {(isOwn || canModerate) && (
            <button title="Delete" onClick={() => onDelete(message.id)}>🗑</button>
          )}
        </div>
      )}
    </div>
  );
}
