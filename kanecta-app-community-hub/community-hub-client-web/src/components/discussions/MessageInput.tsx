import { useState, type KeyboardEvent } from "react";

interface Props {
  placeholder: string;
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
}

export default function MessageInput({ placeholder, onSend, disabled }: Props) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);

  async function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const content = value.trim();
      if (!content || sending) return;
      setSending(true);
      try {
        await onSend(content);
        setValue("");
      } finally {
        setSending(false);
      }
    }
  }

  return (
    <div className="discussions-input">
      <textarea
        className="discussions-input__field"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled || sending}
        rows={1}
      />
    </div>
  );
}
