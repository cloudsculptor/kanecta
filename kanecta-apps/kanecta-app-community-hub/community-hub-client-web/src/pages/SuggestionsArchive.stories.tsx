import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { StoryWrapper } from "../stories/MockProviders";
import SuggestionsArchive from "./SuggestionsArchive";

const ARCHIVED = [
  {
    id: "s1",
    content: "It would be great to have a community tool library where people can borrow things like ladders and drills rather than everyone buying their own.",
    submitted_by_name: "Sarah K",
    submitted_at: "2026-05-19T11:00:00Z",
    archived_at: "2026-05-21T09:15:00Z",
    archived_by_id: "user-mod-1",
  },
  {
    id: "s2",
    content: "Can we add a section for local tradespeople so residents can find trusted plumbers, electricians etc?",
    submitted_by_name: null,
    submitted_at: "2026-05-18T09:30:00Z",
    archived_at: "2026-05-20T14:00:00Z",
    archived_by_id: "user-mod-1",
  },
  {
    id: "s3",
    content: "A community ride-sharing board would be useful — people going to Masterton or Wellington could offer spare seats.",
    submitted_by_name: "Tom B",
    submitted_at: "2026-05-10T08:00:00Z",
    archived_at: "2026-05-12T10:30:00Z",
    archived_by_id: "user-mod-2",
  },
];

const meta: Meta<typeof SuggestionsArchive> = {
  title: "Pages/SuggestionsArchive",
  component: SuggestionsArchive,
  decorators: [(Story) => <StoryWrapper role="moderator"><Story /></StoryWrapper>],
};
export default meta;

type Story = StoryObj<typeof SuggestionsArchive>;

/** Archive with several past suggestions. */
export const WithArchived: Story = {
  parameters: {
    msw: { handlers: [http.get("/api/suggestions/archived", () => HttpResponse.json(ARCHIVED))] },
  },
};

/** Empty archive — nothing archived yet. */
export const Empty: Story = {
  parameters: {
    msw: { handlers: [http.get("/api/suggestions/archived", () => HttpResponse.json([]))] },
  },
};

/** API load error. */
export const LoadError: Story = {
  parameters: {
    msw: {
      handlers: [http.get("/api/suggestions/archived", () => HttpResponse.json({ error: "Server error" }, { status: 500 }))],
    },
  },
};

/** Mobile viewport. */
export const Mobile: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile2" },
    msw: { handlers: [http.get("/api/suggestions/archived", () => HttpResponse.json(ARCHIVED))] },
  },
};
