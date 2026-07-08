import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent, expect, fn } from "storybook/test";
import MentionInput from "./MentionInput";

const users = [
  { id: "u1", name: "Alice Brennan" },
  { id: "u2", name: "Ben Tukaki" },
  { id: "u3", name: "Caro Ngata" },
];

const meta: Meta<typeof MentionInput> = {
  title: "Discussions/MentionInput",
  component: MentionInput,
  decorators: [(Story) => <div style={{ padding: 20, maxWidth: 600 }}><Story /></div>],
  // onSend is a fn() spy so behaviour stories can assert it fires with the exact
  // content + fileIds contract. Storybook resets it before each story's play.
  args: {
    placeholder: "Message #general",
    onSend: fn(),
    users,
  },
};
export default meta;
type Story = StoryObj<typeof MentionInput>;

/** Default empty state — send button is disabled until you type something. */
export const Default: Story = {};

/** Disabled — both the textarea and send button are greyed out. */
export const Disabled: Story = { args: { disabled: true } };

/** No users configured — @ will produce no autocomplete dropdown. */
export const NoUsers: Story = { args: { users: [] } };

/** Large user list — verifies search filtering works across many names. */
export const ManyUsers: Story = {
  args: {
    users: [
      { id: "u1", name: "Alice Brennan" },
      { id: "u2", name: "Ben Tukaki" },
      { id: "u3", name: "Caro Ngata" },
      { id: "u4", name: "David Hou" },
      { id: "u5", name: "Eva Ramirez" },
      { id: "u6", name: "Finn Okafor" },
      { id: "u7", name: "Grace Yip" },
      { id: "u8", name: "Hemi Parata" },
    ],
  },
};

/**
 * File attach button — the paperclip is visible on the left of the textarea.
 * Clicking it opens a file picker. In Storybook, the upload will fail gracefully
 * (no real API) and show "Upload failed" in the attachment bar.
 */
export const WithAttachButton: Story = {
  name: "With attach button (paperclip visible)",
};

/**
 * Disabled state with attach button — both the textarea and attach button
 * should be greyed out and non-interactive.
 */
export const DisabledWithAttach: Story = {
  args: { disabled: true },
  name: "Disabled — textarea and attach both greyed out",
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// Pin the interactive contract of the composer: typing, sending (button + Enter),
// the disabled guard, and @mention autocomplete. Assertions match the exact
// placeholder / aria-labels / rendered names in the component.

/** Typing into the textarea updates its value. */
export const TypingUpdatesField: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByPlaceholderText("Message #general");
    await userEvent.type(box, "Hello market crew");
    await expect(box).toHaveValue("Hello market crew");
  },
};

/** The send button is disabled until there is content, then enables. */
export const SendDisabledUntilTyped: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const send = canvas.getByRole("button", { name: "Send message" });
    await expect(send).toBeDisabled();
    await userEvent.type(canvas.getByRole("textbox"), "ready now");
    await expect(send).toBeEnabled();
  },
};

/** Clicking Send calls onSend with the trimmed content and an empty fileIds array. */
export const ClickSendCallsOnSend: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox"), "  weekend plan  ");
    await userEvent.click(canvas.getByRole("button", { name: "Send message" }));
    await expect(args.onSend).toHaveBeenCalledWith("weekend plan", []);
  },
};

/** Enter (no Shift) sends the message and then clears the textarea. */
export const EnterSendsAndClears: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole("textbox");
    await userEvent.type(box, "sending via enter{Enter}");
    await expect(args.onSend).toHaveBeenCalledWith("sending via enter", []);
    await expect(box).toHaveValue("");
  },
};

/** Shift+Enter inserts a newline instead of sending. */
export const ShiftEnterDoesNotSend: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole("textbox");
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    await expect(args.onSend).not.toHaveBeenCalled();
    await expect(box).toHaveValue("line one\nline two");
  },
};

/** Disabled composer: textarea, send and attach are all non-interactive. */
export const DisabledPreventsSending: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("textbox")).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Send message" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Attach file" })).toBeDisabled();
  },
};

/** Typing "@" opens the mention dropdown listing the configured users. */
export const MentionDropdownShowsUsers: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox"), "hey @");
    await expect(canvas.getByText("Alice Brennan")).toBeInTheDocument();
    await expect(canvas.getByText("Ben Tukaki")).toBeInTheDocument();
    await expect(canvas.getByText("Caro Ngata")).toBeInTheDocument();
  },
};

/** Typing "@" plus a query filters the dropdown to matching users only. */
export const MentionDropdownFilters: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox"), "@Ali");
    await expect(canvas.getByText("Alice Brennan")).toBeInTheDocument();
    await expect(canvas.queryByText("Ben Tukaki")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Caro Ngata")).not.toBeInTheDocument();
  },
};

/** Selecting a user from the dropdown inserts an encoded @[Name](id) mention. */
export const SelectingMentionInsertsEncoded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole("textbox");
    await userEvent.type(box, "@Ali");
    await userEvent.click(canvas.getByText("Alice Brennan"));
    await expect(box).toHaveValue("@[Alice Brennan](u1) ");
  },
};

/** End-to-end: select a mention then send — onSend receives the encoded content. */
export const SendsEncodedMention: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole("textbox");
    await userEvent.type(box, "@Ben");
    await userEvent.click(canvas.getByText("Ben Tukaki"));
    await userEvent.click(canvas.getByRole("button", { name: "Send message" }));
    await expect(args.onSend).toHaveBeenCalledWith("@[Ben Tukaki](u2)", []);
  },
};

/** With no users configured, "@" produces no autocomplete dropdown. */
export const NoUsersNoDropdown: Story = {
  args: { users: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox"), "@a");
    await expect(canvas.queryByText("Alice Brennan")).not.toBeInTheDocument();
  },
};
