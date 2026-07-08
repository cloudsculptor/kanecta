import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TypeList, type TypeItem } from '@kanecta/component-type-list';

// Regression for the types-list filter crash: a type whose `value` is missing
// (null/undefined) must not throw when the user types into the filter. The
// filter predicate previously called t.value.toLowerCase() with no guard, so a
// single malformed type took down the whole view.
const TYPES = [
  { id: '11111111-1111-4111-8111-111111111111', value: 'Person', description: 'a human' },
  // Malformed rows — the shapes that used to crash the filter.
  { id: '22222222-2222-4222-8222-222222222222', value: null as unknown as string },
  { id: '33333333-3333-4333-8333-333333333333', value: undefined as unknown as string, tags: 'org' },
  { id: '44444444-4444-4444-8444-444444444444', value: 'Organisation' },
] satisfies TypeItem[];

function renderList() {
  return render(
    <TypeList
      types={TYPES}
      selectedTypeId={null}
      onSelect={() => {}}
    />,
  );
}

describe('TypeList filter — null/absent value hardening', () => {
  it('does not crash when filtering with a null-value type present', async () => {
    renderList();
    const input = screen.getByPlaceholderText('Filter types…');
    // Typing used to throw synchronously during render; assert it filters instead.
    await userEvent.type(input, 'person');
    expect(screen.getByText('Person')).toBeInTheDocument();
    expect(screen.queryByText('Organisation')).not.toBeInTheDocument();
  });

  it('matches on a non-value field (tags) without touching the null value', async () => {
    renderList();
    await userEvent.type(screen.getByPlaceholderText('Filter types…'), 'org');
    // The tags:'org' type (id 3333, null value) matches via tags, so the list is
    // not empty — proving the matcher ran past its missing value without throwing.
    // (It also matches 'Organisation'.)
    expect(screen.queryByText('No matches')).not.toBeInTheDocument();
  });

  it('shows "No matches" for a query nothing satisfies (still no crash)', async () => {
    renderList();
    await userEvent.type(screen.getByPlaceholderText('Filter types…'), 'zzzznope');
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });
});
