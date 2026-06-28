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
  const outerRef = useRef<HTMLDivElement>(null);
  const pickerContainerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const el = pickerContainerRef.current;
    if (!outer || !el) return;

    // Pre-calculate position from the trigger's bounding rect BEFORE mounting
    // the picker, so there is no timing dependency on the web component rendering.
    const parent = outer.parentElement;
    if (parent) {
      const r = parent.getBoundingClientRect();

      // Not enough space above → open downward instead
      if (r.top < PICKER_HEIGHT + GAP) {
        outer.style.bottom = "auto";
        outer.style.top = `calc(100% + ${GAP}px)`;
      }

      // Right edge would overflow → align picker's right edge with trigger
      if (r.left + PICKER_WIDTH > window.innerWidth) {
        outer.style.left = "auto";
        outer.style.right = "0";
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
    outer.style.visibility = "visible";

    return () => { pickerRef.current?.remove(); };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (outerRef.current && !outerRef.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={outerRef}
      style={{
        position: "absolute",
        zIndex: 200,
        bottom: "calc(100% + 4px)",
        left: 0,
        visibility: "hidden",
      }}
    >
      <div ref={pickerContainerRef} />
      <div style={{ textAlign: "right", paddingTop: 2 }}>
        <a
          href="https://fonts.google.com/noto/specimen/Noto+Emoji"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 10, color: "#bbb", textDecoration: "none" }}
        >
          Noto Emoji (Apache 2.0)
        </a>
      </div>
    </div>
  );
}
