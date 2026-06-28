import type { Meta, StoryObj } from '@storybook/react';
import { QualityControlView } from './QualityControlView';

const wrap = (Story: React.ComponentType) => (
  <div style={{ width: 900, height: 500, position: 'relative', background: 'var(--color-bg, #fff)' }}>
    <Story />
  </div>
);

const meta: Meta<typeof QualityControlView> = {
  component: QualityControlView,
  title: 'Views/QualityControlView',
  decorators: [wrap],
};
export default meta;

type Story = StoryObj<typeof QualityControlView>;

const SAMPLE_STATS = {
  total: 42,
  typedCount: 27,
  unstructured: [
    { type: 'text',     count: 8 },
    { type: 'string',   count: 5 },
    { type: 'number',   count: 2 },
  ],
  structured: [
    { typeId: 'aaa-111', name: 'Contact',  icon: 'person',        count: 12 },
    { typeId: 'bbb-222', name: 'Decision', icon: 'gavel',         count:  8 },
    { typeId: 'pipeline', name: 'pipeline', icon: null,           count:  4 },
    { typeId: 'agent',    name: 'agent',    icon: null,           count:  3 },
  ],
};

export const Default: Story = {
  args: { stats: SAMPLE_STATS },
};

export const Loading: Story = {
  args: { isLoading: true },
};

export const Error: Story = {
  args: { error: true },
};

export const NoPrimitives: Story = {
  args: {
    stats: {
      total: 20,
      typedCount: 20,
      unstructured: [],
      structured: [
        { typeId: 'aaa-111', name: 'Contact', icon: 'person', count: 20 },
      ],
    },
  },
};

export const NoStructured: Story = {
  args: {
    stats: {
      total: 15,
      typedCount: 0,
      unstructured: [
        { type: 'text',   count: 10 },
        { type: 'string', count:  5 },
      ],
      structured: [],
    },
  },
};

export const Empty: Story = {
  args: {
    stats: { total: 0, typedCount: 0, unstructured: [], structured: [] },
  },
};
