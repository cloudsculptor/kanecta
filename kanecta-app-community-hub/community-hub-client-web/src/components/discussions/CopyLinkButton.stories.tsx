import type { Meta, StoryObj } from "@storybook/react-vite";
import CopyLinkButton from "./CopyLinkButton";

const meta: Meta<typeof CopyLinkButton> = {
  title: "Discussions/CopyLinkButton",
  component: CopyLinkButton,
  decorators: [(Story) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 40 }}>
      <span style={{ fontSize: 14, opacity: 0.6 }}>Thread header context →</span>
      <Story />
    </div>
  )],
};
export default meta;
type Story = StoryObj<typeof CopyLinkButton>;

/** Default — shows link icon at low opacity, full opacity on hover. */
export const Default: Story = {};
