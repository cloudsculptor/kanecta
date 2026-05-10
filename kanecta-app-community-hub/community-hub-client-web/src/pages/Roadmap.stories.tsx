import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { MockKeycloakProvider } from "../stories/MockProviders";
import Roadmap from "./Roadmap";

const meta: Meta<typeof Roadmap> = {
  title: "Pages/Roadmap",
  component: Roadmap,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <MockKeycloakProvider authenticated>
          <Story />
        </MockKeycloakProvider>
      </MemoryRouter>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof Roadmap>;

/** Desktop — all roadmap items including Constitution at the top. */
export const Default: Story = {};

/** Mobile — check cards stack cleanly and links are tappable. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};
