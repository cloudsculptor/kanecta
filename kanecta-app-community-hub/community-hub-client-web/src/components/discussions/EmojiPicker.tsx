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

    // After picker is in the DOM, nudge position to stay within viewport
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();

      // Flip vertical: if top is clipped, open downward instead of upward
      if (rect.top < 0) {
        el.style.bottom = "auto";
        el.style.top = "calc(100% + 4px)";
      }

      // Flip horizontal: if right edge is clipped, align to right of trigger
      if (rect.right > window.innerWidth) {
        el.style.left = "auto";
        el.style.right = "0";
      }

      // If left edge is clipped, align to left of trigger
      if (rect.left < 0) {
        el.style.right = "auto";
        el.style.left = "0";
      }

      el.style.visibility = "visible";
    });

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
      style={{
        position: "absolute",
        zIndex: 200,
        bottom: "calc(100% + 4px)",
        left: 0,
        visibility: "hidden",
      }}
    />
  );
}
