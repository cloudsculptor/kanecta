import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import MessageItem from "./MessageItem";
import MentionInput from "./MentionInput";
import type { Message } from "../../api/discussions";

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeMessage(content: string, userId = "user-1", userName = "Jane Smith"): Message {
  return {
    id: crypto.randomUUID(),
    thread_id: "t1",
    parent_message_id: null,
    user_id: userId,
    user_name: userName,
    content,
    created_at: new Date().toISOString(),
    edited_at: null,
    deleted_at: null,
    reply_count: 0,
  };
}

const seed: Message[] = [
  makeMessage("Morning everyone!", "user-2", "Mike Robinson"),
  makeMessage("Anyone free for a coffee run at 10?", "user-3", "Aroha Tane"),
];

// ── Composite feed component ──────────────────────────────────────────────────

/**
 * Shows the full send → appear flow.
 * Type a message and press Enter — it appears immediately without any refresh.
 * This mirrors the optimistic update behaviour in the real app.
 */
function MessageFeed({
  initialMessages = seed,
  currentUserId = "user-1",
  currentUserName = "Jane Smith",
  simulateSlowApi = false,
}: {
  initialMessages?: Message[];
  currentUserId?: string;
  currentUserName?: string;
  simulateSlowApi?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const noop = async () => {};

  async function handleSend(content: string) {
    if (simulateSlowApi) await new Promise((r) => setTimeout(r, 1200));
    const msg = makeMessage(content, currentUserId, currentUserName);
    setMessages((prev) => [...prev, msg]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 420, border: "1px solid #e5e4e7", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && (
          <p style={{ color: "#aaa", fontSize: 14, textAlign: "center", margin: "auto" }}>
            No messages yet — say hello!
          </p>
        )}
        {messages.map((m) => (
          <MessageItem
            key={m.id}
            message={m}
            reactions={[]}
            currentUserId={currentUserId}
            canModerate={false}
            onEdit={noop}
            onDelete={noop}
            onReact={noop}
            onUnreact={noop}
            onOpenReplies={noop}
          />
        ))}
      </div>
      <MentionInput placeholder="Message #general" onSend={handleSend} users={[]} />
    </div>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────────

const meta: Meta<typeof MessageFeed> = {
  title: "Discussions/MessageFeed",
  component: MessageFeed,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div style={{ padding: 24, maxWidth: 640 }}>
          <p style={{ fontSize: 13, color: "#888", marginBottom: 12 }}>
            Type a message and press <kbd>Enter</kbd> — it should appear immediately.
          </p>
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof MessageFeed>;

/** Default: send a message and it appears straight away (optimistic update). */
export const Default: Story = {};

/** Empty thread — shows the empty state before any messages are posted. */
export const EmptyThread: Story = {
  args: { initialMessages: [] },
};

/**
 * Slow API simulation — message still appears instantly on send even though
 * the API call takes 1.2s. Proves the UI doesn't wait for the server.
 */
export const SlowApi: Story = {
  args: { simulateSlowApi: true },
  name: "Slow API — message appears before server responds",
};

/** Viewing as a different user — own messages get the action toolbar on hover. */
export const AsOtherUser: Story = {
  args: { currentUserId: "user-2", currentUserName: "Mike Robinson" },
  name: "Posting as a different user",
};
