import { useState } from "react";
import type { Message, Reaction } from "../../api/discussions";
import EmojiPicker from "./EmojiPicker";
import { parseContent } from "./MentionInput";

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

// ── Grayscale SVG icons for the action toolbar ────────────────────────────────

const IconSmiley = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M8 14s1.5 2 4 2 4-2 4-2" />
    <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const IconReply = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const IconEdit = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

const IconTrash = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────

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
            {parseContent(message.content).map((seg, i) => {
              if (seg.type === "mention")
                return <span key={i} className="discussions-mention-pill">@{seg.value}</span>;
              if (seg.type === "url")
                return (
                  <a key={i} href={seg.value} target="_blank" rel="noopener noreferrer"
                    className="discussions-message__link">{seg.value}</a>
                );
              return <span key={i}>{seg.value}</span>;
            })}
          </p>
        )}

        {reactions.length > 0 && !editing && (
          <div className="discussions-message__reactions" style={{ position: "relative" }}>
            {reactions.map((r) => {
              const reacted = r.user_ids.includes(currentUserId);
              const names = (r.user_names || r.user_ids).join(", ");
              return (
                <button
                  key={r.emoji}
                  className={`discussions-reaction${reacted ? " discussions-reaction--own" : ""}`}
                  onClick={() => reacted ? onUnreact(message.id, r.emoji) : onReact(message.id, r.emoji)}
                  title={names}
                >
                  {r.emoji} {r.count}
                </button>
              );
            })}

            {/* Add reaction pill — always rendered to hold its space, visible only on hover */}
            <div style={{ position: "relative", display: "flex", alignItems: "center", visibility: hovered ? "visible" : "hidden" }}>
              <button
                className="discussions-reaction discussions-reaction--add"
                onClick={() => setShowEmoji((v) => !v)}
                title="Add reaction"
              >
                <IconSmiley /> +
              </button>
              {showEmoji && (
                <EmojiPicker
                  onSelect={(emoji) => { onReact(message.id, emoji); setShowEmoji(false); }}
                  onClose={() => setShowEmoji(false)}
                />
              )}
            </div>
          </div>
        )}

        {message.reply_count > 0 && !editing && (
          <button className="discussions-message__reply-link" onClick={() => onOpenReplies(message)}>
            {message.reply_count} {Number(message.reply_count) === 1 ? "reply" : "replies"}
          </button>
        )}
      </div>

      {hovered && !editing && (
        <div className="discussions-message__actions">
          <div style={{ position: "relative" }}>
            <button title="Add reaction" onClick={() => setShowEmoji((v) => !v)}>
              <IconSmiley />
            </button>
            {showEmoji && !reactions.length && (
              <EmojiPicker
                onSelect={(emoji) => { onReact(message.id, emoji); setShowEmoji(false); }}
                onClose={() => setShowEmoji(false)}
              />
            )}
          </div>
          <button title="Reply in thread" onClick={() => onOpenReplies(message)}>
            <IconReply />
          </button>
          {isOwn && (
            <button title="Edit" onClick={() => { setEditing(true); setEditValue(message.content); }}>
              <IconEdit />
            </button>
          )}
          {(isOwn || canModerate) && (
            <button title="Delete" onClick={() => onDelete(message.id)}>
              <IconTrash />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
