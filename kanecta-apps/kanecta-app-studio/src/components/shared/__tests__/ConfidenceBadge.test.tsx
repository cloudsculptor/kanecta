import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfidenceBadge } from '../ConfidenceBadge';

describe('ConfidenceBadge', () => {
  it.each([
    ['low', 'Low'],
    ['medium', 'Med'],
    ['high', 'High'],
    ['verified', 'Verified'],
    ['locked', 'Locked'],
  ] as const)('renders %s confidence correctly', (confidence, label) => {
    render(<ConfidenceBadge confidence={confidence} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('applies the correct CSS class for low', () => {
    const { container } = render(<ConfidenceBadge confidence="low" />);
    expect(container.firstChild).toHaveClass('ConfidenceBadge--low');
  });

  it('applies the correct CSS class for locked', () => {
    const { container } = render(<ConfidenceBadge confidence="locked" />);
    expect(container.firstChild).toHaveClass('ConfidenceBadge--locked');
  });
});
