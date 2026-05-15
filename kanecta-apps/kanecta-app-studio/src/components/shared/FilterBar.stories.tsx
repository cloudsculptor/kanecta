import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FilterBar } from './FilterBar';
import type { FilterState } from '../../types/ui';

const meta: Meta<typeof FilterBar> = {
  component: FilterBar,
  title: 'Shared/FilterBar',
};
export default meta;

type Story = StoryObj<typeof FilterBar>;

function Demo({ initialFilter }: { initialFilter?: FilterState }) {
  const [filter, setFilter] = useState<FilterState>(initialFilter ?? {});
  return (
    <FilterBar
      filter={filter}
      onChange={setFilter}
      totalCount={42}
      filteredCount={filter.type ? 12 : 42}
    />
  );
}

export const Empty: Story = { render: () => <Demo /> };
export const WithTypeFilter: Story = { render: () => <Demo initialFilter={{ type: 'fact' }} /> };
export const WithSearch: Story = { render: () => <Demo initialFilter={{ search: 'quantum' }} /> };
export const AllFilters: Story = {
  render: () => <Demo initialFilter={{ search: 'test', type: 'claim', confidence: 'high' }} />,
};
