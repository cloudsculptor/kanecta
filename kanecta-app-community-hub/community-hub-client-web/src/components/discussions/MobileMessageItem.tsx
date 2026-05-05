import { useState, useRef } from "react";
import type { Message, Reaction } from "../../api/discussions";
import { parseContent } from "./MentionInput";

const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const LONG_PRESS_MS = 500;

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

export default function MobileMessageItem({
  message, reactions, currentUserId, canModerate,
  onEdit, onDelete, onReact, onUnreact, onOpenReplies,
}: Props) {
  const [showSheet, setShowSheet] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });

  const isOwn = message.user_id === currentUserId;
  const isDeleted = !!message.deleted_at;
  const canAct = isOwn || canModerate;

  function handleTouchStart(e: React.TouchEvent) {
    if (isDeleted || editing) return;
    const touch = e.touches[0];
    startPosRef.current = { x: touch.clientX, y: touch.clientY };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      suppressClickRef.current = true;
      setShowSheet(true);
    }, LONG_PRESS_MS);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!timerRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startPosRef.current.x;
    const dy = touch.clientY - startPosRef.current.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleTouchEnd() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleClick() {
    if (suppressClickRef.current) { suppressClickRef.current = false; return; }
    if (!isDeleted && !editing) onOpenReplies(message);
  }

  async function saveEdit() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== message.content) await onEdit(message.id, trimmed);
    setEditing(false);
  }

  async function handleQuickReact(emoji: string) {
    setShowSheet(false);
    const alreadyReacted = reactions.find((r) => r.emoji === emoji)?.user_ids.includes(currentUserId);
    if (alreadyReacted) await onUnreact(message.id, emoji);
    else await onReact(message.id, emoji);
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
    <>
      <div
        className="discussions-message"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleClick}
      >
        <div className="discussions-message__avatar">{avatar(message.user_name)}</div>
        <div className="discussions-message__body">
          <div className="discussions-message__meta">
            <span className="discussions-message__author">{message.user_name}</span>
            <span className="discussions-message__time">{formatTime(message.created_at)}</span>
            {message.edited_at && <span className="discussions-message__edited">(edited)</span>}
          </div>

          {editing ? (
            <div className="discussions-message__edit" onClick={(e) => e.stopPropagation()}>
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
                      className="discussions-message__link" onClick={(e) => e.stopPropagation()}>
                      {seg.value}
                    </a>
                  );
                return <span key={i}>{seg.value}</span>;
              })}
            </p>
          )}

          {reactions.length > 0 && !editing && (
            <div className="discussions-message__reactions" onClick={(e) => e.stopPropagation()}>
              {reactions.map((r) => {
                const reacted = r.user_ids.includes(currentUserId);
                return (
                  <button
                    key={r.emoji}
                    className={`discussions-reaction${reacted ? " discussions-reaction--own" : ""}`}
                    onClick={() => reacted ? onUnreact(message.id, r.emoji) : onReact(message.id, r.emoji)}
                    title={(r.user_names || r.user_ids).join(", ")}
                  >
                    {r.emoji} {r.count}
                  </button>
                );
              })}
            </div>
          )}

          {message.reply_count > 0 && !editing && (
            <button
              className="discussions-message__reply-link"
              onClick={(e) => { e.stopPropagation(); onOpenReplies(message); }}
            >
              {message.reply_count} {Number(message.reply_count) === 1 ? "reply" : "replies"}
            </button>
          )}
        </div>
      </div>

      {showSheet && (
        <>
          <div className="dm-msg-sheet__overlay" onClick={() => setShowSheet(false)} />
          <div className="dm-msg-sheet">
            <div className="dm-msg-sheet__handle" />

            <div className="dm-msg-sheet__reactions">
              {QUICK_EMOJI.map((emoji) => {
                const reacted = reactions.find((r) => r.emoji === emoji)?.user_ids.includes(currentUserId);
                return (
                  <button
                    key={emoji}
                    className={`dm-msg-sheet__emoji${reacted ? " dm-msg-sheet__emoji--reacted" : ""}`}
                    onClick={() => handleQuickReact(emoji)}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>

            {canAct && <div className="dm-msg-sheet__divider" />}

            {isOwn && (
              <button
                className="dm-msg-sheet__action"
                onClick={() => { setShowSheet(false); setEditValue(message.content); setEditing(true); }}
              >
                Edit
              </button>
            )}

            {canAct && (
              <button
                className="dm-msg-sheet__action dm-msg-sheet__action--danger"
                onClick={() => { setShowSheet(false); onDelete(message.id); }}
              >
                Delete
              </button>
            )}

            <div className="dm-msg-sheet__divider" />
            <button className="dm-msg-sheet__action dm-msg-sheet__action--cancel" onClick={() => setShowSheet(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </>
  );
}
