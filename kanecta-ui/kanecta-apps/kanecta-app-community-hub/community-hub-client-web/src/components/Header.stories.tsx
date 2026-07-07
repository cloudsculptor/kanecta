import type { Meta, StoryObj } from "@storybook/react-vite";
import { within, expect } from "storybook/test";
import Header from "./Header";
import { StoryWrapper } from "../stories/MockProviders";

// Header consumes the real useKeycloak()/useUserRoles() hooks. In Storybook no
// KeycloakProvider is mounted, so useKeycloak() returns its default context value
// (authenticated: false) and Header renders its logged-out state: brand + Log in
// + Sign up. StoryWrapper supplies the MemoryRouter that useNavigate() needs.
const meta: Meta<typeof Header> = {
  title: "Components/Header",
  component: Header,
  decorators: [(Story) => <StoryWrapper role="public"><Story /></StoryWrapper>],
};
export default meta;
type Story = StoryObj<typeof Header>;

/** Logged-out header — brand plus Log in / Sign up affordances. */
export const LoggedOut: Story = {};

/** The brand title renders. */
export const RendersBrand: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Featherston")).toBeInTheDocument();
  },
};

/** Unauthenticated users see both Log in and Sign up controls. */
export const ShowsLoginAffordances: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Sign up" })).toBeInTheDocument();
  },
};

/** No account menu is shown while logged out. */
export const NoAccountMenuWhenLoggedOut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
  },
};
