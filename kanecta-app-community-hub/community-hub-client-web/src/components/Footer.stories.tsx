import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import Footer from "./Footer";

const meta: Meta<typeof Footer> = {
  title: "Components/Footer",
  component: Footer,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1 }} />
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof Footer>;

/** Desktop — all four links shown inline. */
export const Desktop: Story = {
  parameters: { viewport: { defaultViewport: "desktop" } },
};

/** Mobile — only "About · ···" visible. Tap ··· to open the bottom sheet. */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
  name: "Mobile (About + ··· menu)",
};

/** Mobile bottom sheet open — tap ··· in the Mobile story to trigger, or view this snapshot. */
export const MobileSheetOpen: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
  name: "Mobile — bottom sheet open",
  render: () => {
    // Render a static snapshot of the sheet being open
    return (
      <MemoryRouter>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative" }}>
          <div style={{ flex: 1, background: "rgba(0,0,0,0.3)" }} />
          <div style={{ background: "#fff", borderRadius: "16px 16px 0 0", padding: "8px 0 32px", boxShadow: "0 -4px 24px rgba(0,0,0,0.12)" }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "#e5e4e7", margin: "8px auto 16px" }} />
            {["About this site", "Roadmap", "Source code (AGPL)", "Emoji: Noto Emoji (Apache 2.0)"].map((label, i, arr) => (
              <div key={label} style={{ padding: "14px 24px", fontSize: 16, color: "#08060d", borderBottom: i < arr.length - 1 ? "1px solid #e5e4e7" : "none" }}>
                {label}
              </div>
            ))}
          </div>
        </div>
      </MemoryRouter>
    );
  },
};
