import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { SlashMenu, SLASH_ITEMS, type SlashMenuHandle } from '../SlashMenu';

describe('SlashMenu', () => {
  it('renders all items', () => {
    render(<SlashMenu items={SLASH_ITEMS} command={() => {}} />);
    expect(screen.getAllByRole('button').length).toBe(SLASH_ITEMS.length);
  });

  it('renders nothing when items is empty', () => {
    const { container } = render(<SlashMenu items={[]} command={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls command when an item is clicked', async () => {
    const command = vi.fn();
    render(<SlashMenu items={SLASH_ITEMS.slice(0, 3)} command={command} />);
    await userEvent.click(screen.getAllByRole('button')[1]);
    expect(command).toHaveBeenCalledWith(SLASH_ITEMS[1]);
  });

  it('first item is selected by default', () => {
    render(<SlashMenu items={SLASH_ITEMS.slice(0, 3)} command={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0].className).toContain('--selected');
    expect(buttons[1].className).not.toContain('--selected');
  });

  it('ArrowDown selects next item via ref', async () => {
    const ref = createRef<SlashMenuHandle>();
    render(<SlashMenu ref={ref} items={SLASH_ITEMS.slice(0, 3)} command={() => {}} />);
    await act(async () => {
      ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    });
    const buttons = screen.getAllByRole('button');
    expect(buttons[1].className).toContain('--selected');
  });

  it('ArrowUp wraps to last item', async () => {
    const ref = createRef<SlashMenuHandle>();
    render(<SlashMenu ref={ref} items={SLASH_ITEMS.slice(0, 3)} command={() => {}} />);
    await act(async () => {
      ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    });
    const buttons = screen.getAllByRole('button');
    expect(buttons[2].className).toContain('--selected');
  });

  it('Enter calls command with selected item', async () => {
    const command = vi.fn();
    const ref = createRef<SlashMenuHandle>();
    render(<SlashMenu ref={ref} items={SLASH_ITEMS.slice(0, 3)} command={command} />);
    ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(command).toHaveBeenCalledWith(SLASH_ITEMS[0]);
  });

  it('returns false for unhandled keys', () => {
    const ref = createRef<SlashMenuHandle>();
    render(<SlashMenu ref={ref} items={SLASH_ITEMS.slice(0, 2)} command={() => {}} />);
    const handled = ref.current!.onKeyDown(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(handled).toBe(false);
  });
});
