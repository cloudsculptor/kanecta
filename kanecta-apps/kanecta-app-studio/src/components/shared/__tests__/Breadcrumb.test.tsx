import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Breadcrumb } from '../Breadcrumb';

const items = [
  { id: '1', label: 'Home' },
  { id: '2', label: 'Science' },
  { id: '3', label: 'Physics' },
];

describe('Breadcrumb', () => {
  it('renders nothing when items is empty', () => {
    const { container } = render(<Breadcrumb items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all items', () => {
    render(<Breadcrumb items={items} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Science')).toBeInTheDocument();
    expect(screen.getByText('Physics')).toBeInTheDocument();
  });

  it('marks last item as current', () => {
    render(<Breadcrumb items={items} />);
    expect(screen.getByText('Physics')).toHaveAttribute('aria-current', 'page');
  });

  it('calls onNavigate when a non-current item is clicked', async () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb items={items} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText('Home'));
    expect(onNavigate).toHaveBeenCalledWith('1');
  });

  it('does not call onNavigate when current item is clicked', async () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb items={items} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText('Physics'));
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
