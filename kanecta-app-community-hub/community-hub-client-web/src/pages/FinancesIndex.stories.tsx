import type { Meta, StoryObj } from "@storybook/react-vite";
import { StoryWrapper } from "../stories/MockProviders";
import FinancesIndex from "./FinancesIndex";

const meta: Meta<typeof FinancesIndex> = {
  title: "Pages/Finances/Index",
  component: FinancesIndex,
  decorators: [(Story) => <StoryWrapper role="TEAM"><Story /></StoryWrapper>],
};
export default meta;
type Story = StoryObj<typeof FinancesIndex>;

export const MemberView: Story = {};

export const GuestView: Story = {
  decorators: [(Story) => <StoryWrapper role="GUEST"><Story /></StoryWrapper>],
};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: "mobile2" } },
};
