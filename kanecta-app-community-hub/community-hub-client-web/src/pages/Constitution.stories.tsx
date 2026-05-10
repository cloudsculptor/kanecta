import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { MockKeycloakProvider } from "../stories/MockProviders";
import Constitution from "./Constitution";

const meta: Meta<typeof Constitution> = {
  title: "Pages/Constitution",
  component: Constitution,
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
type Story = StoryObj<typeof Constitution>;

export const Default: Story = {};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};
