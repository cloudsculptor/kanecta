import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { MentionDropdown, type MentionDropdownHandle } from '../MentionDropdown';
import type { KanectaItem } from '../../../types/kanecta';

const items: KanectaItem[] = [
  { id: '1', value: 'Alpha item', type: 'fact', confidence: 'high', sortOrder: 0, tags: [], createdAt: '', modifiedAt: '' },
  { id: '2', value: 'Beta item', type: 'claim', confidence: 'low', sortOrder: 1, tags: [], createdAt: '', modifiedAt: '' },
  { id: '3', value: 'Gamma item', type: 'note', confidence: 'medium', sortOrder: 2, tags: [], createdAt: '', modifiedAt: '' },
];

describe('MentionDropdown', () => {
  it('renders each item', () => {
    render(<MentionDropdown items={items} command={() => {}} />);
    expect(screen.getByText('Alpha item')).toBeInTheDocument();
    expect(screen.getByText('Beta item')).toBeInTheDocument();
    expect(screen.getByText('Gamma item')).toBeInTheDocument();
  });

  it('shows empty message when no items', () => {
    render(<MentionDropdown items={[]} command={() => {}} />);
    expect(screen.getByText(/no items found/i)).toBeInTheDocument();
  });

  it('calls command when an item is clicked', async () => {
    const command = vi.fn();
    render(<MentionDropdown items={items} command={command} />);
    await userEvent.click(screen.getByText('Alpha item'));
    expect(command).toHaveBeenCalledWith(items[0]);
  });

  it('first item is selected by default', () => {
    render(<MentionDropdown items={items} command={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0].className).toContain('--selected');
    expect(buttons[1].className).not.toContain('--selected');
  });

  it('ArrowDown moves selection forward', async () => {
    const ref = createRef<MentionDropdownHandle>();
    render(<MentionDropdown ref={ref} items={items} command={() => {}} />);
    await act(async () => {
      ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    const buttons = screen.getAllByRole('button');
    expect(buttons[1].className).toContain('--selected');
  });

  it('ArrowDown wraps around', async () => {
    const ref = createRef<MentionDropdownHandle>();
    render(<MentionDropdown ref={ref} items={items} command={() => {}} />);
    await act(async () => {
      ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
      ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    const buttons = screen.getAllByRole('button');
    expect(buttons[0].className).toContain('--selected');
  });

  it('Enter calls command with selected item', () => {
    const command = vi.fn();
    const ref = createRef<MentionDropdownHandle>();
    render(<MentionDropdown ref={ref} items={items} command={command} />);
    ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(command).toHaveBeenCalledWith(items[0]);
  });

  it('returns true for handled keys', () => {
    const ref = createRef<MentionDropdownHandle>();
    render(<MentionDropdown ref={ref} items={items} command={() => {}} />);
    expect(ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))).toBe(true);
    expect(ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }))).toBe(true);
    expect(ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true);
  });

  it('returns false for unhandled keys', () => {
    const ref = createRef<MentionDropdownHandle>();
    render(<MentionDropdown ref={ref} items={items} command={() => {}} />);
    expect(ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(false);
  });
});
