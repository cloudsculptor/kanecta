import { useState } from "react";
import type { SiteNode } from "../api/site-nodes";

interface Props {
  node: SiteNode;
  siblings: SiteNode[];
  index: number;
  onMove: (direction: "up" | "down") => Promise<void>;
  onDelete: () => Promise<void>;
}

export default function SiteNodeControls({ siblings, index, onMove, onDelete }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function move(dir: "up" | "down") {
    setBusy(true);
    try { await onMove(dir); } finally { setBusy(false); }
  }

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return; }
    setBusy(true);
    try { await onDelete(); } finally { setBusy(false); setConfirming(false); }
  }

  return (
    <span className="site-node-controls">
      <button
        className="site-node-controls__btn"
        onClick={() => move("up")}
        disabled={busy || index === 0}
        title="Move up"
        type="button"
      >↑</button>
      <button
        className="site-node-controls__btn"
        onClick={() => move("down")}
        disabled={busy || index === siblings.length - 1}
        title="Move down"
        type="button"
      >↓</button>
      <button
        className={`site-node-controls__btn site-node-controls__btn--delete${confirming ? " site-node-controls__btn--confirm" : ""}`}
        onClick={handleDelete}
        disabled={busy}
        title={confirming ? "Click again to confirm delete" : "Delete"}
        type="button"
      >
        {confirming ? "Sure?" : "×"}
      </button>
    </span>
  );
}
