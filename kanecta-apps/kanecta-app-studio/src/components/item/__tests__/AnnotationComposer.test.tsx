import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { AnnotationComposer } from '../AnnotationComposer';

const theme = createTheme();
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
);

describe('AnnotationComposer', () => {
  it('renders a textarea', () => {
    render(<AnnotationComposer onSubmit={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByLabelText('Annotation text')).toBeInTheDocument();
  });

  it('submit button is disabled when textarea is empty', () => {
    render(<AnnotationComposer onSubmit={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByRole('button', { name: /add annotation/i })).toBeDisabled();
  });

  it('calls onSubmit with the trimmed value', async () => {
    const onSubmit = vi.fn();
    render(<AnnotationComposer onSubmit={onSubmit} />, { wrapper: Wrapper });
    await userEvent.type(screen.getByLabelText('Annotation text'), 'Great point');
    await userEvent.click(screen.getByRole('button', { name: /add annotation/i }));
    expect(onSubmit).toHaveBeenCalledWith('Great point');
  });

  it('clears the textarea after submit', async () => {
    render(<AnnotationComposer onSubmit={() => {}} />, { wrapper: Wrapper });
    const textarea = screen.getByLabelText('Annotation text');
    await userEvent.type(textarea, 'Some content');
    await userEvent.click(screen.getByRole('button', { name: /add annotation/i }));
    expect(textarea).toHaveValue('');
  });

  it('shows reply label when replyingTo is provided', () => {
    render(
      <AnnotationComposer onSubmit={() => {}} replyingTo="ann-1" onCancelReply={() => {}} />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText(/replying to annotation/i)).toBeInTheDocument();
  });

  it('calls onCancelReply when cancel is clicked', async () => {
    const onCancel = vi.fn();
    render(
      <AnnotationComposer onSubmit={() => {}} replyingTo="ann-1" onCancelReply={onCancel} />,
      { wrapper: Wrapper },
    );
    await userEvent.click(screen.getByText('cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
