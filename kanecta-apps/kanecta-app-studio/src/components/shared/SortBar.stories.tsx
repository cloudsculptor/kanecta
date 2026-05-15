import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { SortBar } from './SortBar';
import type { SortState } from '../../types/ui';

const meta: Meta<typeof SortBar> = {
  component: SortBar,
  title: 'Shared/SortBar',
};
export default meta;

type Story = StoryObj<typeof SortBar>;

function Demo() {
  const [sort, setSort] = useState<SortState>({ field: 'sortOrder', direction: 'asc' });
  return <SortBar sort={sort} onChange={setSort} />;
}

export const Default: Story = { render: () => <Demo /> };
