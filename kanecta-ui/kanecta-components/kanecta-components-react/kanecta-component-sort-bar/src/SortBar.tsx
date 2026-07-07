import type { SortState } from '@kanecta/component-core';
import './SortBar.scss';

export type { SortState };

const SORT_FIELDS: { value: SortState['field']; label: string }[] = [
  { value: 'sortOrder', label: 'Order' },
  { value: 'value', label: 'Name' },
  { value: 'confidence', label: 'Confidence' },
  { value: 'createdAt', label: 'Created' },
  { value: 'modifiedAt', label: 'Modified' },
];

export interface SortBarProps {
  sort: SortState;
  onChange: (sort: SortState) => void;
}

export function SortBar({ sort, onChange }: SortBarProps) {
  return (
    <div className="SortBar">
      <span className="SortBar__label">Sort by</span>
      <select
        className="SortBar__select"
        value={sort.field}
        onChange={(e) => onChange({ ...sort, field: e.target.value as SortState['field'] })}
        aria-label="Sort field"
      >
        {SORT_FIELDS.map(({ value, label }) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <button
        className="SortBar__dir"
        onClick={() => onChange({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
        aria-label={`Sort direction: ${sort.direction}`}
      >
        {sort.direction === 'asc' ? '↑ Asc' : '↓ Desc'}
      </button>
    </div>
  );
}
