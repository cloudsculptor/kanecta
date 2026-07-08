import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import Download from "./Download";

// AUTH: Download reads the REAL useKeycloak() (default { authenticated: false })
// and useUserRoles(). MockProviders' MockKeycloakContext is a separate context
// the app does not consume, so in Storybook the page is always unauthenticated
// and renders the login gate. prepareDownload / downloadZip only fire on button
// clicks behind the authenticated && canDownload guard, so they never run here.
//
// Handlers below are defensive documentation of the endpoints; they do not fire
// under these stories.
const downloadHandlers = [
  http.post("/api/download/prepare", () => HttpResponse.json({ token: "tok123", size: 2048 })),
  http.get("/api/download/:token", () => new HttpResponse(new Blob(["zip"]), { status: 200 })),
];

const meta: Meta<typeof Download> = {
  title: "Pages/Download",
  component: Download,
  decorators: [(Story) => <StoryWrapper role="team"><Story /></StoryWrapper>],
  parameters: { msw: { handlers: downloadHandlers } },
};
export default meta;
type Story = StoryObj<typeof Download>;

/** Unauthenticated (the only reachable state in isolation) → login gate. */
export const LoginGate: Story = {};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/**
 * The guest gate renders: the log-in prompt paragraph plus the "Log in" and
 * "Sign up for free" actions. The team download panel must not render.
 */
export const LoginGateShowsPrompt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("You need to be logged in to download site content."),
    ).toBeInTheDocument();
    // There may be more than one "Log in" affordance (gate + header) — assert at least one.
    await expect(canvas.getAllByRole("button", { name: "Log in" })[0]).toBeInTheDocument();
    await expect(canvas.getByText("Sign up for free")).toBeInTheDocument();

    // The authenticated download panel is not reachable in isolation.
    await expect(canvas.queryByText("Prepare download")).not.toBeInTheDocument();
    await expect(
      canvas.queryByText("This feature is available to team members only."),
    ).not.toBeInTheDocument();
  },
};
