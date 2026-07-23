import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { within, userEvent, expect } from "storybook/test";
import SiteNodeEditor from "./SiteNodeEditor";
import { makeNode, minutesTree } from "../stories/siteNodeFixtures";

// SiteNodeEditor is self-contained (trigger button → inline form), so unlike
// the index pages it can be exercised fully in stories — including the
// moderator-only flows that never render there.
const meta: Meta<typeof SiteNodeEditor> = {
  title: "Components/SiteNodeEditor",
  component: SiteNodeEditor,
  parameters: {
    msw: {
      handlers: [
        http.post("/api/site-nodes", () => HttpResponse.json(makeNode({ slug: "new", title: "New" }))),
        http.put("/api/site-nodes/:id", () => HttpResponse.json({})),
      ],
    },
  },
};
export default meta;

type Story = StoryObj<typeof SiteNodeEditor>;

/** Add-group mode: the trigger renders closed. */
export const AddGroup: Story = {
  args: { mode: "add-group", parentNode: minutesTree(), onSaved: () => {} },
};

/** Rename mode against an existing category node (shows the description field). */
export const RenameCategory: Story = {
  args: {
    mode: "rename",
    node: makeNode({
      slug: "custodian-board-2026",
      title: "2026",
      metadata: { level: "category", description: "Custodian Board meeting minutes from 2026." },
    }),
    onSaved: () => {},
  },
};

/** Add-category mode under a group parent. */
export const AddCategory: Story = {
  args: {
    mode: "add-category",
    parentNode: makeNode({ slug: "custodian-board", title: "Custodian Board", metadata: { level: "group" } }),
    govType: "policy",
    onSaved: () => {},
  },
};

// ── Behaviour tests (play functions) ─────────────────────────────────────────

/** Clicking the trigger opens the form; the title input accepts text. */
export const OpensAndAcceptsInput: Story = {
  args: { mode: "add-group", parentNode: minutesTree(), onSaved: () => {} },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button");
    await userEvent.click(trigger);
    const input = await canvas.findByRole("textbox");
    await userEvent.type(input, "Working Groups");
    await expect(input).toHaveValue("Working Groups");
  },
};
