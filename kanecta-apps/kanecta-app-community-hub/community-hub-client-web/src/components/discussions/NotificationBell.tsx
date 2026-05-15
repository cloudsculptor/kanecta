import { useState } from "react";
import { pushApi } from "../../api/push";
import { usePushDevice } from "../../hooks/usePushDevice";

interface Props {
  threadId: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

const BellOn = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6V11c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
  </svg>
);

const BellOff = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
  </svg>
);

export default function NotificationBell({ threadId, enabled, onToggle }: Props) {
  const { status, subscribe } = usePushDevice();
  const [busy, setBusy] = useState(false);

  if (status === "unsupported") return null;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (status !== "subscribed") {
        await subscribe();
      }
      if (enabled) {
        await pushApi.unsubscribeThread(threadId);
        onToggle(false);
      } else {
        await pushApi.subscribeThread(threadId);
        onToggle(true);
      }
    } catch {
      // silently ignore — bell state stays unchanged
    } finally {
      setBusy(false);
    }
  }

  const label = status === "denied"
    ? "Notifications blocked — enable in browser settings"
    : enabled ? "Mute thread notifications" : "Get notified about new messages";

  return (
    <button
      className={`discussions-bell${enabled ? " discussions-bell--on" : ""}`}
      onClick={toggle}
      disabled={busy || status === "denied"}
      title={label}
      aria-label={label}
    >
      {enabled ? <BellOn /> : <BellOff />}
    </button>
  );
}
