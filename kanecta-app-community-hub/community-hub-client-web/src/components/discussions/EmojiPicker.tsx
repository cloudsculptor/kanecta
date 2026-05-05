import { useEffect, useRef } from "react";
import { Picker } from "emoji-mart";
import data from "@emoji-mart/data";

// Approximate rendered dimensions for our picker config (perLine:7, emojiButtonSize:28).
// Height 435 is emoji-mart's hardcoded CSS value; width is min-content ≈ 352px + sidebar.
const PICKER_HEIGHT = 440;
const PICKER_WIDTH = 360;
const GAP = 4;

interface Props {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onSelect, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Pre-calculate position from the trigger's bounding rect BEFORE mounting
    // the picker, so there is no timing dependency on the web component rendering.
    const parent = el.parentElement;
    if (parent) {
      const r = parent.getBoundingClientRect();

      // Not enough space above → open downward instead
      if (r.top < PICKER_HEIGHT + GAP) {
        el.style.bottom = "auto";
        el.style.top = `calc(100% + ${GAP}px)`;
      }

      // Right edge would overflow → align picker's right edge with trigger
      if (r.left + PICKER_WIDTH > window.innerWidth) {
        el.style.left = "auto";
        el.style.right = "0";
      }
    }

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

    el.appendChild(pickerRef.current);
    el.style.visibility = "visible";

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
