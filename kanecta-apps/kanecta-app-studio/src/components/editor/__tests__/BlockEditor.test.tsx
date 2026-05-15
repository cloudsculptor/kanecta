import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { BlockEditor } from '../BlockEditor';

let onBlurCallback: ((args: { editor: { getHTML: () => string } }) => void) | undefined;

vi.mock('@tiptap/react', () => ({
  useEditor: vi.fn((options: { onBlur?: (args: { editor: { getHTML: () => string } }) => void; content?: string }) => {
    onBlurCallback = options.onBlur;
    return {
      getHTML: () => options.content ?? '',
      commands: {},
      isDestroyed: false,
    };
  }),
  EditorContent: ({ className }: { className: string }) => (
    <div data-testid="editor-content" className={className} />
  ),
  ReactRenderer: vi.fn(),
}));

vi.mock('@tiptap/starter-kit', () => ({ default: {} }));
vi.mock('@tiptap/extension-placeholder', () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock('@tiptap/extension-mention', () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock('@tiptap/suggestion', () => ({ default: vi.fn() }));
vi.mock('@tiptap/core', () => ({ Extension: { create: vi.fn(() => ({})) } }));
vi.mock('tippy.js', () => ({ default: vi.fn(() => [{ destroy: vi.fn(), hide: vi.fn(), setProps: vi.fn() }]) }));

const mockUpdate = vi.fn().mockResolvedValue({ id: 'item-1', value: '', type: 'text' });
vi.mock('../../../store/workspace', () => ({
  useWorkspaceStore: () => ({
    getApi: () => ({ items: { update: mockUpdate }, tree: { full: vi.fn().mockResolvedValue([]) } }),
    primaryWorkspace: { id: 'ws-1' },
  }),
}));

const theme = createTheme();

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}

describe('BlockEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onBlurCallback = undefined;
  });

  it('renders the editor content area', () => {
    render(<BlockEditor itemId="item-1" initialContent="" />, { wrapper: Wrapper });
    expect(screen.getByTestId('editor-content')).toBeInTheDocument();
  });

  it('does not show saving indicator initially', () => {
    render(<BlockEditor itemId="item-1" initialContent="" />, { wrapper: Wrapper });
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });

  it('calls api update on blur when content has changed', async () => {
    const newContent = '<p>Changed content</p>';
    render(<BlockEditor itemId="item-1" initialContent="<p>Original</p>" />, { wrapper: Wrapper });

    await act(async () => {
      onBlurCallback?.({ editor: { getHTML: () => newContent } });
    });

    expect(mockUpdate).toHaveBeenCalledWith('item-1', { value: newContent });
  });

  it('does not call api update when content is unchanged on blur', async () => {
    const content = '<p>Same content</p>';
    render(<BlockEditor itemId="item-1" initialContent={content} />, { wrapper: Wrapper });

    await act(async () => {
      onBlurCallback?.({ editor: { getHTML: () => content } });
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not call api update twice for same content', async () => {
    const initial = '<p>Initial</p>';
    const updated = '<p>Updated</p>';
    render(<BlockEditor itemId="item-1" initialContent={initial} />, { wrapper: Wrapper });

    await act(async () => {
      onBlurCallback?.({ editor: { getHTML: () => updated } });
    });
    await act(async () => {
      onBlurCallback?.({ editor: { getHTML: () => updated } });
    });

    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});
