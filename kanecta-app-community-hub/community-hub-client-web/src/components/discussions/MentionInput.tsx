import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import data from "@emoji-mart/data";

interface User {
  id: string;
  name: string;
}

interface Props {
  placeholder: string;
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
  users: User[];
}

export type ContentSegment =
  | { type: "text"; value: string }
  | { type: "mention"; value: string }
  | { type: "url"; value: string };

// Parse message content into text, @mention, and URL segments for rendering
export function parseContent(content: string): ContentSegment[] {
  const result: ContentSegment[] = [];

  // First split by encoded mention pattern: @[Name](userId)
  const mentionParts = content.split(/(@\[[^\]]+\]\([^)]+\))/g);

  for (const part of mentionParts) {
    const mentionMatch = part.match(/^@\[([^\]]+)\]\(([^)]+)\)$/);
    if (mentionMatch) {
      result.push({ type: "mention", value: mentionMatch[1] });
      continue;
    }

    // Within text segments, split by URLs
    const urlParts = part.split(/(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g);
    for (const seg of urlParts) {
      if (!seg) continue;
      if (/^https?:\/\//.test(seg)) {
        result.push({ type: "url", value: seg });
      } else {
        result.push({ type: "text", value: seg });
      }
    }
  }

  return result;
}

// Keep old export name as alias so existing imports don't break
export const parseMentions = parseContent;

// Encode a mention: @[Name](userId)
export function encodeMention(user: User) {
  return `@[${user.name}](${user.id})`;
}

// ── Emoji search ──────────────────────────────────────────────────────────────

interface EmojiEntry {
  id: string;
  name: string;
  keywords: string[];
  skins: { native: string }[];
}

const allEmojis = Object.values(
  (data as { emojis: Record<string, EmojiEntry> }).emojis
);

function searchEmojis(query: string, max = 8): EmojiEntry[] {
  const q = query.toLowerCase();
  const exact: EmojiEntry[] = [];
  const starts: EmojiEntry[] = [];
  const rest: EmojiEntry[] = [];
  for (const e of allEmojis) {
    if (e.id === q) exact.push(e);
    else if (e.id.startsWith(q)) starts.push(e);
    else if (e.id.includes(q) || e.keywords?.some((k) => k.startsWith(q))) rest.push(e);
    if (exact.length + starts.length >= max) break;
  }
  return [...exact, ...starts, ...rest].slice(0, max);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function MentionInput({ placeholder, onSend, disabled, users }: Props) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  const [mentionSearch, setMentionSearch] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionIndex, setMentionIndex] = useState(0);

  const [emojiSearch, setEmojiSearch] = useState<string | null>(null);
  const [emojiStart, setEmojiStart] = useState(-1);
  const [emojiIndex, setEmojiIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredMentions = mentionSearch !== null
    ? users.filter((u) => u.name.toLowerCase().includes(mentionSearch.toLowerCase())).slice(0, 6)
    : [];

  const filteredEmojis = emojiSearch !== null ? searchEmojis(emojiSearch) : [];

  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, 200);
    el.style.height = `${newHeight}px`;
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, []);

  function clearDropdowns() {
    setMentionSearch(null);
    setEmojiSearch(null);
  }

  async function doSend() {
    const content = value.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await onSend(content);
      setValue("");
      clearDropdowns();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.overflowY = "hidden";
        textareaRef.current.focus();
      }
    } finally {
      setSending(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    const cursor = e.target.selectionStart;
    setValue(val);
    autoResize(e.target);

    const textToCursor = val.slice(0, cursor);

    // @ mention takes priority
    const atMatch = textToCursor.match(/@([^@\s]*)$/);
    if (atMatch) {
      setMentionSearch(atMatch[1]);
      setMentionStart(cursor - atMatch[0].length);
      setMentionIndex(0);
      setEmojiSearch(null);
      return;
    }
    setMentionSearch(null);

    // : emoji — must start with a letter to avoid matching timestamps/URLs
    const colonMatch = textToCursor.match(/:([a-z][a-z0-9_+\-]*)$/i);
    if (colonMatch) {
      setEmojiSearch(colonMatch[1]);
      setEmojiStart(cursor - colonMatch[0].length);
      setEmojiIndex(0);
    } else {
      setEmojiSearch(null);
    }
  }

  function selectMention(user: User) {
    const before = value.slice(0, mentionStart);
    const after = value.slice(textareaRef.current?.selectionStart ?? mentionStart + (mentionSearch?.length ?? 0) + 1);
    const inserted = encodeMention(user) + " ";
    setValue(before + inserted + after);
    setMentionSearch(null);
    setTimeout(() => {
      const pos = before.length + inserted.length;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    }, 0);
  }

  function selectEmoji(emoji: EmojiEntry) {
    const native = emoji.skins[0].native;
    const before = value.slice(0, emojiStart);
    const after = value.slice(textareaRef.current?.selectionStart ?? emojiStart + (emojiSearch?.length ?? 0) + 1);
    setValue(before + native + after);
    setEmojiSearch(null);
    setTimeout(() => {
      const pos = before.length + native.length;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
      if (textareaRef.current) autoResize(textareaRef.current);
    }, 0);
  }

  async function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Mention dropdown navigation
    if (mentionSearch !== null && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex((i) => Math.min(i + 1, filteredMentions.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); selectMention(filteredMentions[mentionIndex]); return; }
      if (e.key === "Escape") { setMentionSearch(null); return; }
    }

    // Emoji dropdown navigation
    if (emojiSearch !== null && filteredEmojis.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setEmojiIndex((i) => Math.min(i + 1, filteredEmojis.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setEmojiIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); selectEmoji(filteredEmojis[emojiIndex]); return; }
      if (e.key === "Escape") { setEmojiSearch(null); return; }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  }

  return (
    <div className="discussions-input" style={{ position: "relative" }}>
      {mentionSearch !== null && filteredMentions.length > 0 && (
        <div className="discussions-mention-list">
          {filteredMentions.map((u, i) => (
            <button
              key={u.id}
              className={`discussions-mention-item${i === mentionIndex ? " discussions-mention-item--selected" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); selectMention(u); }}
            >
              <span className="discussions-mention-item__avatar">{u.name[0]}</span>
              {u.name}
            </button>
          ))}
        </div>
      )}
      {emojiSearch !== null && filteredEmojis.length > 0 && (
        <div className="discussions-mention-list">
          {filteredEmojis.map((e, i) => (
            <button
              key={e.id}
              className={`discussions-mention-item${i === emojiIndex ? " discussions-mention-item--selected" : ""}`}
              onMouseDown={(ev) => { ev.preventDefault(); selectEmoji(e); }}
            >
              <span className="discussions-mention-item__avatar discussions-mention-item__avatar--emoji">
                {e.skins[0].native}
              </span>
              <span className="discussions-emoji-id">:{e.id}:</span>
              <span className="discussions-emoji-name">{e.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="discussions-input__row">
        <textarea
          ref={textareaRef}
          className="discussions-input__field"
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled || sending}
          rows={3}
        />
        <button
          className="discussions-input__send"
          onClick={doSend}
          disabled={!value.trim() || sending}
          aria-label="Send message"
          title="Send (Enter)"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
