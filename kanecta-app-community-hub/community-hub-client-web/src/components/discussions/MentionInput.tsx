import { useState, useRef, useCallback, type KeyboardEvent } from "react";

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

export default function MentionInput({ placeholder, onSend, disabled, users }: Props) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [mentionSearch, setMentionSearch] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filtered = mentionSearch !== null
    ? users.filter((u) => u.name.toLowerCase().includes(mentionSearch.toLowerCase())).slice(0, 6)
    : [];

  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    const newHeight = Math.min(el.scrollHeight, 200);
    el.style.height = `${newHeight}px`;
    // Only show scrollbar when content exceeds max height
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, []);

  async function doSend() {
    const content = value.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await onSend(content);
      setValue("");
      setMentionSearch(null);
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

    // Detect @ trigger
    const textToCursor = val.slice(0, cursor);
    const atMatch = textToCursor.match(/@([^@\s]*)$/);
    if (atMatch) {
      setMentionSearch(atMatch[1]);
      setMentionStart(cursor - atMatch[0].length);
      setSelectedIndex(0);
    } else {
      setMentionSearch(null);
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

  async function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionSearch !== null && filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab" || (e.key === "Enter" && mentionSearch !== null)) {
        e.preventDefault();
        selectMention(filtered[selectedIndex]);
        return;
      }
      if (e.key === "Escape") { setMentionSearch(null); return; }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  }

  return (
    <div className="discussions-input" style={{ position: "relative" }}>
      {mentionSearch !== null && filtered.length > 0 && (
        <div className="discussions-mention-list">
          {filtered.map((u, i) => (
            <button
              key={u.id}
              className={`discussions-mention-item${i === selectedIndex ? " discussions-mention-item--selected" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); selectMention(u); }}
            >
              <span className="discussions-mention-item__avatar">{u.name[0]}</span>
              {u.name}
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
          rows={1}
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
