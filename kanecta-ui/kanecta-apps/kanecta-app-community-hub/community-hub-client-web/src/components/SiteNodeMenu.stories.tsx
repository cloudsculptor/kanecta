import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, userEvent, expect } from "storybook/test";
import SiteNodeMenu from "./SiteNodeMenu";
import { makeNode } from "../stories/siteNodeFixtures";

// The moderator ⋯ menu on governance index rows. Self-contained (trigger +
// popover views), so the moderator-only flows hidden on the page stories are
// fully exercisable here.
const group = makeNode({ slug: "custodian-board", title: "Custodian Board", metadata: { level: "group" } });
const category = makeNode({
  slug: "custodian-bylaws",
  title: "Custodian Board Bylaws",
  metadata: { level: "category", description: "Binding rules." },
});
const sibling = makeNode({ slug: "volunteers", title: "Volunteers", metadata: { level: "group" } });

const meta: Meta<typeof SiteNodeMenu> = {
  title: "Components/SiteNodeMenu",
  component: SiteNodeMenu,
  parameters: {
    msw: {
      handlers: [
        http.put("/api/site-nodes/:id", () => HttpResponse.json({})),
        http.post("/api/site-nodes", () => HttpResponse.json(category)),
      ],
    },
  },
  args: {
    onMove: async () => {},
    onDelete: async () => {},
    onSaved: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof SiteNodeMenu>;

/** A group node's menu (offers Add category for group levels with govType). */
export const GroupNode: Story = {
  args: { node: group, siblings: [group, sibling], index: 0, govType: "policy" },
};

/** A category node's menu with a page count (guards deletion). */
export const CategoryNode: Story = {
  args: { node: category, siblings: [category], index: 0, pageCount: 3 },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/** The ⋯ trigger opens the menu; move-up is disabled for the first sibling. */
export const OpensMenuWithMoveGuards: Story = {
  args: { node: group, siblings: [group, sibling], index: 0, govType: "policy" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Options" }));
    await expect(await canvas.findByText("Add category")).toBeInTheDocument();
    const up = canvas.getByRole("button", { name: /up/i });
    await expect(up).toBeDisabled();
    const down = canvas.getByRole("button", { name: /down/i });
    await expect(down).toBeEnabled();
  },
};

/** Rename view: opens prefilled with the node title. */
export const RenameViewPrefills: Story = {
  args: { node: category, siblings: [category], index: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Options" }));
    await userEvent.click(await canvas.findByText(/Rename|Edit/));
    const input = await canvas.findByDisplayValue("Custodian Board Bylaws");
    await expect(input).toBeInTheDocument();
  },
};
