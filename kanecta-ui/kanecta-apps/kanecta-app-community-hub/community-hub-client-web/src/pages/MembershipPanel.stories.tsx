import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, expect } from "storybook/test";
import { StoryWrapper } from "../stories/MockProviders";
import MembershipPanel from "./MembershipPanel";
import type { Member } from "../api/members";

// AUTH: MembershipPanel gates on useUserRoles(), which reads the REAL
// KeycloakContext (default { authenticated: false }). MockProviders exposes a
// SEPARATE MockKeycloakContext that app code does NOT consume, so in Storybook
// the panel always sees no roles → canAccess === false → it renders the
// permission-denied path and NEVER fetches. The role-gated data path
// (getMembers / getPendingMembers / getActiveMembers) is unreachable in
// isolation, so the play test asserts the guest path that actually renders.
//
// Handlers/fixtures below are provided only to document the endpoints and to
// guarantee no real network is hit if the page ever did fetch; they do not
// render under these stories.
const SAMPLE_ACTIVE: Member[] = [
  { id: "m1", name: "Alice Brown", username: "alice", email: "alice@example.com", roles: ["team"], enabled: true, createdTimestamp: 1_700_000_000_000 },
  { id: "m2", name: "Bob Carter", username: "bob", email: "bob@example.com", roles: ["moderator"], enabled: true, createdTimestamp: 1_700_000_000_000 },
];
const SAMPLE_PENDING: Member[] = [
  { id: "m3", name: "Carol Dean", username: "carol", email: "carol@example.com", roles: [], enabled: true, createdTimestamp: 1_700_000_000_000 },
];

const membersHandlers = [
  http.get("/api/members", () => HttpResponse.json([...SAMPLE_PENDING, ...SAMPLE_ACTIVE])),
  http.get("/api/members/pending", () => HttpResponse.json(SAMPLE_PENDING)),
  http.get("/api/members/active", () => HttpResponse.json(SAMPLE_ACTIVE)),
  http.post("/api/members/:id/roles/team", () => new HttpResponse(null, { status: 204 })),
];

const meta: Meta<typeof MembershipPanel> = {
  title: "Pages/MembershipPanel",
  component: MembershipPanel,
  decorators: [(Story) => <StoryWrapper role="team"><Story /></StoryWrapper>],
  parameters: { msw: { handlers: membersHandlers } },
};
export default meta;
type Story = StoryObj<typeof MembershipPanel>;

/** Rendered without an admin/moderator role → permission-denied path. */
export const PermissionDenied: Story = {};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/**
 * With no elevated role (the only reachable state in isolation) the panel shows
 * the permission-denied message rather than the member tables.
 */
export const PermissionDeniedShowsMessage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("You don't have permission to view this page."),
    ).toBeInTheDocument();
    // The member sections must NOT render on the guest path.
    await expect(canvas.queryByText("New sign-ups")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Alice Brown")).not.toBeInTheDocument();
  },
};
