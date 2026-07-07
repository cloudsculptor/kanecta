import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, expect } from "storybook/test";
import ComingSoon from "./ComingSoon";

// ComingSoon is a self-contained MUI Alert. Its "log in" control calls the real
// keycloak.login() on click, so behaviour stories assert presence only — clicking
// it would trigger a real auth redirect.
const meta: Meta<typeof ComingSoon> = {
  title: "Components/ComingSoon",
  component: ComingSoon,
  decorators: [(Story) => <div style={{ maxWidth: 600, padding: 20 }}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof ComingSoon>;

/** The info banner. */
export const Default: Story = {};

/** The banner copy and the inline log-in control render. */
export const RendersMessageAndLogin: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/coming soon/i)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "log in" })).toBeInTheDocument();
  },
};
