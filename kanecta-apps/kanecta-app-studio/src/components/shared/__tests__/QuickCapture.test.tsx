import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickCapture } from '../QuickCapture';
import { ThemeProvider, createTheme } from '@mui/material/styles';

const theme = createTheme();
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
);

describe('QuickCapture', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <QuickCapture open={false} onClose={() => {}} onSubmit={() => {}} />,
      { wrapper: Wrapper },
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog when open', () => {
    render(
      <QuickCapture open={true} onClose={() => {}} onSubmit={() => {}} />,
      { wrapper: Wrapper },
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Item value')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(
      <QuickCapture open={true} onClose={onClose} onSubmit={() => {}} />,
      { wrapper: Wrapper },
    );
    await userEvent.click(document.querySelector('.QuickCapture-backdrop')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('submits on Enter with non-empty value', async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(
      <QuickCapture open={true} onClose={onClose} onSubmit={onSubmit} />,
      { wrapper: Wrapper },
    );
    const input = screen.getByLabelText('Item value');
    await userEvent.type(input, 'Hello world{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('Hello world');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not submit on Enter with empty value', async () => {
    const onSubmit = vi.fn();
    render(
      <QuickCapture open={true} onClose={() => {}} onSubmit={onSubmit} />,
      { wrapper: Wrapper },
    );
    const input = screen.getByLabelText('Item value');
    await userEvent.type(input, '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('closes on Escape key', async () => {
    const onClose = vi.fn();
    render(
      <QuickCapture open={true} onClose={onClose} onSubmit={() => {}} />,
      { wrapper: Wrapper },
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
