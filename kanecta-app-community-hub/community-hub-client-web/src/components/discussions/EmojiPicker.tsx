import { useEffect, useRef } from "react";
import { Picker } from "emoji-mart";
import data from "@emoji-mart/data";

interface Props {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    pickerRef.current = new (Picker as unknown as new (opts: object) => HTMLElement)({
      data,
      onEmojiSelect: (e: { native: string }) => {
        onSelect(e.native);
        onClose();
      },
      theme: "light",
      previewPosition: "none",
      skinTonePosition: "none",
      perLine: 7,
      emojiSize: 18,
      emojiButtonSize: 28,
      maxFrequentRows: 2,
    });

    containerRef.current.appendChild(pickerRef.current);
    return () => { pickerRef.current?.remove(); };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", zIndex: 200, bottom: "calc(100% + 4px)", right: 0 }}
    />
  );
}
