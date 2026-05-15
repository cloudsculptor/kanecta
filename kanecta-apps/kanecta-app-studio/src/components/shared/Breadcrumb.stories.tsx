import type { Meta, StoryObj } from '@storybook/react';
import { Breadcrumb } from './Breadcrumb';

const meta: Meta<typeof Breadcrumb> = {
  component: Breadcrumb,
  title: 'Shared/Breadcrumb',
};
export default meta;

type Story = StoryObj<typeof Breadcrumb>;

export const SingleItem: Story = {
  args: { items: [{ id: '1', label: 'Root' }] },
};

export const ThreeLevels: Story = {
  args: {
    items: [
      { id: '1', label: 'Home' },
      { id: '2', label: 'Philosophy' },
      { id: '3', label: 'Epistemology' },
    ],
  },
};

export const WithNavigation: Story = {
  args: {
    items: [
      { id: '1', label: 'Home' },
      { id: '2', label: 'Science' },
      { id: '3', label: 'Physics' },
      { id: '4', label: 'Quantum Mechanics' },
    ],
    onNavigate: (id) => alert(`Navigate to ${id}`),
  },
};

export const Empty: Story = { args: { items: [] } };
