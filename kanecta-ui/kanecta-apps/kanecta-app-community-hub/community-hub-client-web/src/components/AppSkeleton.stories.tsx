import type { Meta, StoryObj } from "@storybook/react";
import AppSkeleton from "./AppSkeleton";

const meta: Meta<typeof AppSkeleton> = {
  component: AppSkeleton,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof AppSkeleton>;

export const Default: Story = {};
