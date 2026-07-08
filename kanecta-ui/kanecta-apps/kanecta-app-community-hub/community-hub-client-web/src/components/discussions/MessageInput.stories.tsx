import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, userEvent, expect, fn } from "storybook/test";
import MessageInput from "./MessageInput";

const meta: Meta<typeof MessageInput> = {
  title: "Discussions/MessageInput",
  component: MessageInput,
  decorators: [(Story) => <div style={{ padding: 20, maxWidth: 600 }}><Story /></div>],
  // onSend is a fn() spy so behaviour stories can assert it fires with the exact
  // trimmed content. Storybook resets it before each story's play.
  args: {
    placeholder: "Message #general",
    onSend: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof MessageInput>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────
// MessageInput has no send button — Enter (no Shift) is the only send trigger.
// Pin: typing, Enter-to-send, Shift+Enter newline, empty guard, disabled guard.

/** Typing into the textarea updates its value. */
export const TypingUpdatesField: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByPlaceholderText("Message #general");
    await userEvent.type(box, "quick note");
    await expect(box).toHaveValue("quick note");
  },
};

/** Enter (no Shift) sends the trimmed content and clears the field. */
export const EnterSendsAndClears: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole("textbox");
    await userEvent.type(box, "  hello there  {Enter}");
    await expect(args.onSend).toHaveBeenCalledWith("hello there");
    await expect(box).toHaveValue("");
  },
};

/** Shift+Enter inserts a newline instead of sending. */
export const ShiftEnterDoesNotSend: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole("textbox");
    await userEvent.type(box, "first{Shift>}{Enter}{/Shift}second");
    await expect(args.onSend).not.toHaveBeenCalled();
    await expect(box).toHaveValue("first\nsecond");
  },
};

/** Pressing Enter on an empty/whitespace-only field does not send. */
export const EmptyEnterDoesNotSend: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox"), "   {Enter}");
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/** Disabled composer: the textarea is non-interactive and cannot send. */
export const DisabledPreventsSending: Story = {
  args: { disabled: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole("textbox");
    await expect(box).toBeDisabled();
    await userEvent.type(box, "should not type{Enter}");
    await expect(box).toHaveValue("");
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};
