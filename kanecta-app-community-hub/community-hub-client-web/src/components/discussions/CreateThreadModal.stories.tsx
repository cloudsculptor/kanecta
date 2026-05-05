import type { Meta, StoryObj } from "@storybook/react-vite";
import CreateThreadModal from "./CreateThreadModal";
import { DuplicateThreadError } from "../../api/discussions";

const meta: Meta<typeof CreateThreadModal> = {
  title: "Discussions/CreateThreadModal",
  component: CreateThreadModal,
  args: {
    open: true,
    onClose: () => {},
    onCreate: async (name, desc) => { console.log("create:", name, desc); },
    onGoToThread: (id) => { console.log("go to thread:", id); },
  },
};
export default meta;
type Story = StoryObj<typeof CreateThreadModal>;

export const Open: Story = {};

export const Closed: Story = {
  args: { open: false },
};

/**
 * Submitting a name that matches an existing thread (case/whitespace insensitive)
 * returns a 409. The modal shows the matching thread name and description, plus
 * a "Go to #thread" button that navigates directly to it.
 */
export const DuplicateThread: Story = {
  args: {
    onCreate: async () => {
      throw new DuplicateThreadError({
        id: "t1",
        name: "General",
        description: "Day-to-day chat for the team",
        created_by_name: "Jane Smith",
        created_at: new Date().toISOString(),
      });
    },
  },
};

/**
 * Same duplicate error but without an onGoToThread handler — the warning
 * shows the thread name/description but no navigation button.
 */
export const DuplicateThreadNoNavigation: Story = {
  args: {
    onGoToThread: undefined,
    onCreate: async () => {
      throw new DuplicateThreadError({
        id: "t1",
        name: "General",
        description: "Day-to-day chat for the team",
        created_by_name: "Jane Smith",
        created_at: new Date().toISOString(),
      });
    },
  },
};
