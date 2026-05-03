import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import type { Message } from "../../api/discussions";

// ── Minimal mock components matching the real layout ──────────────────────────

const THREADS = [
  { id: "t1", name: "general", description: "Morning everyone! Hope you all have a great day." },
  { id: "t2", name: "events", description: "Saturday market is on at 8am" },
  { id: "t3", name: "transport", description: "Two seats free to Wellington Friday 7:30am" },
  { id: "t4", name: "resilience", description: "Meeting notes now posted" },
  { id: "t5", name: "local-help", description: "Looking for a plumber recommendation" },
];

const MESSAGES: Message[] = [
  { id: "m1", thread_id: "t1", parent_message_id: null, user_id: "u2", user_name: "Aroha Tane", content: "Morning everyone! Hope you all have a great day.", created_at: new Date(Date.now() - 3600000).toISOString(), edited_at: null, deleted_at: null, reply_count: 2 },
  { id: "m2", thread_id: "t1", parent_message_id: null, user_id: "u3", user_name: "Mike Robinson", content: "Anyone know if the library is open today?", created_at: new Date(Date.now() - 2400000).toISOString(), edited_at: null, deleted_at: null, reply_count: 0 },
  { id: "m3", thread_id: "t1", parent_message_id: null, user_id: "u4", user_name: "Sarah King", content: "Yes, opens at 10 I think.", created_at: new Date(Date.now() - 1200000).toISOString(), edited_at: null, deleted_at: null, reply_count: 0 },
];

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function MockThreadList({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <aside style={{ background: "#1a2e1d", color: "rgba(255,255,255,0.75)", display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
      <div style={{ padding: "20px 16px 8px", fontSize: 13, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", display: "flex", alignItems: "center" }}>
        Threads
        <button style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 20, cursor: "pointer" }}>+</button>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {THREADS.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => onSelect(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "14px 16px", border: "none", borderBottom: "1px solid rgba(255,255,255,0.06)",
                background: "none", color: "rgba(255,255,255,0.8)", cursor: "pointer", textAlign: "left",
              }}
            >
              <span style={{ opacity: 0.5, fontSize: 16 }}>#</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 15, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                <span style={{ display: "block", fontSize: 12, opacity: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.description}</span>
              </span>
              <span style={{ opacity: 0.3, fontSize: 18 }}>›</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function MockMessageView({ threadName, onBack, onReply }: { threadName: string; onBack: () => void; onReply: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>
      {/* Mobile bar */}
      <div style={{ display: "flex", alignItems: "center", padding: "0 8px 0 0", borderBottom: "1px solid #e5e4e7", minHeight: 52, flexShrink: 0 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 2, border: "none", background: "none", color: "#3a7d44", fontSize: 16, fontWeight: 500, cursor: "pointer", padding: "12px 8px 12px 12px" }}>
          <BackArrow /> Threads
        </button>
        <span style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 16 }}>#{threadName}</span>
        <button style={{ border: "none", background: "none", color: "#3a7d44", fontSize: 24, cursor: "pointer", padding: "8px 12px" }}>+</button>
      </div>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        {MESSAGES.map((m) => (
          <div key={m.id} style={{ display: "flex", gap: 10 }}>
            <div style={{ width: 36, height: 36, minWidth: 36, borderRadius: 6, background: "#3a7d44", color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {m.user_name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#08060d", marginBottom: 2 }}>
                {m.user_name}
                <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 11, opacity: 0.5 }}>9:04 am</span>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: "#6b6375", lineHeight: 1.5 }}>{m.content}</p>
              {m.reply_count > 0 && (
                <button onClick={onReply} style={{ background: "none", border: "none", color: "#3a7d44", fontSize: 13, fontWeight: 500, cursor: "pointer", padding: "4px 0", display: "block" }}>
                  {m.reply_count} {m.reply_count === 1 ? "reply" : "replies"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* Input */}
      <div style={{ padding: "10px 16px", borderTop: "1px solid #e5e4e7" }}>
        <div style={{ display: "flex", alignItems: "center", border: "1px solid #e5e4e7", borderRadius: 8, padding: "0 6px 0 0" }}>
          <input style={{ flex: 1, border: "none", outline: "none", padding: "9px 14px", fontSize: 14, background: "transparent" }} placeholder={`Message #${threadName}`} />
          <button style={{ border: "none", background: "none", color: "#3a7d44", cursor: "pointer", display: "flex", alignItems: "center", padding: "0 4px" }}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function MockReplyView({ onBack }: { onBack: () => void }) {
  const parent = MESSAGES[0];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderBottom: "1px solid #e5e4e7", fontWeight: 700, flexShrink: 0 }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 2, border: "none", background: "none", color: "#3a7d44", fontSize: 16, fontWeight: 500, cursor: "pointer", padding: 0 }}>
          <BackArrow /> Back
        </button>
        <span>Thread</span>
        <span style={{ width: 60 }} />
      </div>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", background: "#fafafa" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#08060d", marginBottom: 4 }}>{parent.user_name}</div>
        <p style={{ margin: 0, fontSize: 14, color: "#6b6375" }}>{parent.content}</p>
      </div>
      <div style={{ flex: 1, padding: "12px 16px", fontSize: 13, color: "#aaa", textAlign: "center" }}>
        2 replies · Start a thread reply below
      </div>
      <div style={{ padding: "10px 16px", borderTop: "1px solid #e5e4e7" }}>
        <div style={{ display: "flex", alignItems: "center", border: "1px solid #e5e4e7", borderRadius: 8, padding: "0 6px 0 0" }}>
          <input style={{ flex: 1, border: "none", outline: "none", padding: "9px 14px", fontSize: 14, background: "transparent" }} placeholder="Reply…" />
          <button style={{ border: "none", background: "none", color: "#3a7d44", cursor: "pointer", display: "flex", alignItems: "center", padding: "0 4px" }}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Full interactive story ────────────────────────────────────────────────────

type MobileView = "threads" | "messages" | "replies";

function MobileDiscussionsDemo() {
  const [view, setView] = useState<MobileView>("threads");
  const [activeThread, setActiveThread] = useState(THREADS[0]);

  function selectThread(id: string) {
    const t = THREADS.find((t) => t.id === id)!;
    setActiveThread(t);
    setView("messages");
  }

  return (
    <div style={{ width: 390, height: 700, border: "12px solid #222", borderRadius: 40, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", position: "relative", background: "#fff" }}>
      <div style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
        {/* Thread list — slides out left when in messages */}
        <div style={{ position: "absolute", inset: 0, transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)", transform: view === "threads" ? "translateX(0)" : "translateX(-100%)", zIndex: 1 }}>
          <MockThreadList onSelect={selectThread} />
        </div>
        {/* Messages — slides in from right */}
        <div style={{ position: "absolute", inset: 0, transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)", transform: view === "messages" ? "translateX(0)" : view === "threads" ? "translateX(100%)" : "translateX(-100%)", zIndex: 2 }}>
          <MockMessageView threadName={activeThread.name} onBack={() => setView("threads")} onReply={() => setView("replies")} />
        </div>
        {/* Replies — slides in from right */}
        <div style={{ position: "absolute", inset: 0, transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)", transform: view === "replies" ? "translateX(0)" : "translateX(100%)", zIndex: 3 }}>
          <MockReplyView onBack={() => setView("messages")} />
        </div>
      </div>
    </div>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: "Discussions/Mobile",
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div style={{ padding: 40, background: "#f0f0f0", minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
  parameters: {
    viewport: { defaultViewport: "mobile2" },
  },
};
export default meta;
type Story = StoryObj;

/**
 * Full interactive mobile demo. Tap a thread to slide into messages.
 * Tap a reply count to slide into the thread view. Use back buttons to return.
 */
export const Interactive: Story = {
  render: () => <MobileDiscussionsDemo />,
  name: "Interactive — tap threads, messages, replies",
};

/** Thread list only — what the user sees on first load. */
export const ThreadListView: Story = {
  render: () => (
    <div style={{ width: 390, height: 700, border: "12px solid #222", borderRadius: 40, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <MockThreadList onSelect={() => {}} />
    </div>
  ),
  name: "Thread list (initial view)",
};

/** Message view — after tapping a thread. */
export const MessageView: Story = {
  render: () => (
    <div style={{ width: 390, height: 700, border: "12px solid #222", borderRadius: 40, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <MockMessageView threadName="general" onBack={() => {}} onReply={() => {}} />
    </div>
  ),
  name: "Messages (after selecting a thread)",
};

/** Reply panel — after tapping a reply count. */
export const ReplyView: Story = {
  render: () => (
    <div style={{ width: 390, height: 700, border: "12px solid #222", borderRadius: 40, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
      <MockReplyView onBack={() => {}} />
    </div>
  ),
  name: "Thread replies (after tapping reply count)",
};
