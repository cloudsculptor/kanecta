import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { MockKeycloakProvider } from "../stories/MockProviders";
import TeamRequired from "./TeamRequired";

const meta: Meta<typeof TeamRequired> = {
  title: "Pages/TeamRequired",
  component: TeamRequired,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <MockKeycloakProvider authenticated={true}>
          <Story />
        </MockKeycloakProvider>
      </MemoryRouter>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof TeamRequired>;

export const Default: Story = {};
