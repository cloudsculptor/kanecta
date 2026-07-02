import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { RunFunctionDialog } from '../components/RunFunctionDialog';
import { TreeViewContext } from '../context';
import type { TreeViewApi, KanectaItem } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const theme = createTheme();

const api = {
  items: {
    getFunctionData: vi.fn(),
    runFunctionScaffold: vi.fn(),
    checkFunctionScaffold: vi.fn(),
    getFunctionPackageJson: vi.fn(),
  },
};

const contextValue = {
  api: api as unknown as TreeViewApi,
  workspaceKey: undefined,
  vscodeAvailable: false,
  focusedItemId: null,
    todoMode: false,
  onFocusItem: () => {},
  onSelectItem: () => {},
  onOpenOverlay: () => {},
};

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>
    <TreeViewContext.Provider value={contextValue}>
      {children}
    </TreeViewContext.Provider>
  </ThemeProvider>
);

const mockItem: KanectaItem = {
  id: '12345678-1234-1234-1234-123456789abc',
  value: 'processData',
  type: 'function',
  confidence: null,
  sortOrder: 0,
  tags: [],
  createdAt: null,
  modifiedAt: null,
};

const noArgFnData = {
  description: 'Returns a greeting',
  parameters: [],
  returnType: 'string',
};

const withArgsFnData = {
  description: 'Processes input data',
  parameters: [
    { name: 'input', type: 'string', optional: false },
    { name: 'limit', type: 'number', optional: true },
  ],
  returnType: 'boolean',
};

const withDefaultFnData = {
  parameters: [
    { name: 'count', type: 'number', optional: false, defaultValue: '10' },
  ],
  returnType: 'void',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function renderDialog(
  props: Partial<{ open: boolean; onClose: () => void; item: KanectaItem }> = {},
) {
  const onClose = vi.fn();
  render(
    <RunFunctionDialog open={true} onClose={onClose} item={mockItem} {...props} />,
    { wrapper: Wrapper },
  );
  await waitFor(
    () => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
    { timeout: 3000 },
  );
  return { onClose };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RunFunctionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.items.getFunctionData.mockResolvedValue(noArgFnData);
    api.items.runFunctionScaffold.mockResolvedValue({ success: true, output: '"hello"', logs: '' });
    api.items.checkFunctionScaffold.mockResolvedValue({ exists: true, stale: false });
    api.items.getFunctionPackageJson.mockResolvedValue(null);
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('shows the dialog title with item name', async () => {
    await renderDialog();
    expect(screen.getByText('Run function')).toBeInTheDocument();
    expect(screen.getByText('processData')).toBeInTheDocument();
  });

  it('shows a loading spinner while fetching function data', () => {
    api.items.getFunctionData.mockReturnValue(new Promise(() => {}));
    render(<RunFunctionDialog open={true} onClose={vi.fn()} item={mockItem} />, { wrapper: Wrapper });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows the Logs panel header after loading', async () => {
    await renderDialog();
    expect(screen.getByText('Logs')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <RunFunctionDialog open={false} onClose={vi.fn()} item={mockItem} />,
      { wrapper: Wrapper },
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  // ── Data loading ────────────────────────────────────────────────────────────

  it('calls getFunctionData with item id on open', async () => {
    await renderDialog();
    expect(api.items.getFunctionData).toHaveBeenCalledWith(mockItem.id);
  });

  it('shows function description', async () => {
    await renderDialog();
    expect(screen.getByText('Returns a greeting')).toBeInTheDocument();
  });

  it('shows "no arguments" when function has no parameters', async () => {
    await renderDialog();
    expect(screen.getByText(/no arguments/i)).toBeInTheDocument();
  });

  it('shows input fields for each parameter', async () => {
    api.items.getFunctionData.mockResolvedValue(withArgsFnData);
    await renderDialog();
    // One textbox per param — "input" and "limit" each get a text field
    const textboxes = screen.getAllByRole('textbox');
    expect(textboxes.length).toBeGreaterThanOrEqual(2);
    // The param labels appear as spans in the dialog
    expect(screen.getAllByText('input').length).toBeGreaterThan(0);
    expect(screen.getAllByText('limit').length).toBeGreaterThan(0);
  });

  it('shows return type label', async () => {
    await renderDialog();
    expect(screen.getByText(/Returns:/)).toBeInTheDocument();
    expect(screen.getByText('string')).toBeInTheDocument();
  });

  it('pre-fills input with defaultValue from function data', async () => {
    api.items.getFunctionData.mockResolvedValue(withDefaultFnData);
    await renderDialog();
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();
  });

  it('shows error alert when getFunctionData fails', async () => {
    api.items.getFunctionData.mockRejectedValue(new Error('network'));
    await renderDialog();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Failed to load/i)).toBeInTheDocument();
  });

  it('resets state when dialog reopens', async () => {
    api.items.runFunctionScaffold.mockResolvedValue({ success: true, output: '"cached"', logs: '' });
    const { rerender } = render(
      <RunFunctionDialog open={true} onClose={vi.fn()} item={mockItem} />,
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(), { timeout: 3000 });
    await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => screen.getByText('"cached"'));

    rerender(
      <ThemeProvider theme={theme}>
        <TreeViewContext.Provider value={contextValue}>
          <RunFunctionDialog open={false} onClose={vi.fn()} item={mockItem} />
        </TreeViewContext.Provider>
      </ThemeProvider>,
    );
    rerender(
      <ThemeProvider theme={theme}>
        <TreeViewContext.Provider value={contextValue}>
          <RunFunctionDialog open={true} onClose={vi.fn()} item={mockItem} />
        </TreeViewContext.Provider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByText('"cached"')).not.toBeInTheDocument();
    expect(screen.queryByText(/Logs — success/i)).not.toBeInTheDocument();
  });

  // ── Run button state ──────────────────────────────────────────────────────

  it('Run button is enabled when function has no required params', async () => {
    await renderDialog();
    expect(screen.getByRole('button', { name: /^Run$/ })).toBeEnabled();
  });

  it('Run button is disabled when a required param is empty', async () => {
    api.items.getFunctionData.mockResolvedValue(withArgsFnData);
    await renderDialog();
    expect(screen.getByRole('button', { name: /^Run$/ })).toBeDisabled();
  });

  it('Run button becomes enabled once required params are filled', async () => {
    api.items.getFunctionData.mockResolvedValue(withArgsFnData);
    await renderDialog();
    const inputs = screen.getAllByRole('textbox');
    await userEvent.type(inputs[0], 'hello');
    expect(screen.getByRole('button', { name: /^Run$/ })).toBeEnabled();
  });

  it('optional params do not block the Run button', async () => {
    api.items.getFunctionData.mockResolvedValue({
      parameters: [{ name: 'flag', type: 'boolean', optional: true }],
      returnType: 'void',
    });
    await renderDialog();
    expect(screen.getByRole('button', { name: /^Run$/ })).toBeEnabled();
  });

  it('param with defaultValue counts as filled for Run validation', async () => {
    api.items.getFunctionData.mockResolvedValue(withDefaultFnData);
    await renderDialog();
    expect(screen.getByRole('button', { name: /^Run$/ })).toBeEnabled();
  });

  // ── Execution ─────────────────────────────────────────────────────────────

  it('calls runFunctionScaffold with item id and current args', async () => {
    api.items.getFunctionData.mockResolvedValue(withArgsFnData);
    await renderDialog();
    const inputs = screen.getAllByRole('textbox');
    await userEvent.type(inputs[0], 'world');
    await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() =>
      expect(api.items.runFunctionScaffold).toHaveBeenCalledWith(
        mockItem.id,
        expect.objectContaining({ input: 'world' }),
      ),
    );
  });

  it('shows output panel with return value after successful run', async () => {
    api.items.runFunctionScaffold.mockResolvedValue({
      success: true,
      output: '"hello world"',
      logs: '',
    });
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByText('Output')).toBeInTheDocument());
    expect(screen.getByText('"hello world"')).toBeInTheDocument();
  });

  it('shows logs in the right panel after run', async () => {
    api.items.runFunctionScaffold.mockResolvedValue({
      success: true,
      output: null,
      logs: 'step 1\nstep 2',
    });
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByText(/step 1/)).toBeInTheDocument());
  });

  it('logs header shows "Logs — success" after a successful run', async () => {
    api.items.runFunctionScaffold.mockResolvedValue({ success: true, output: '42', logs: '' });
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByText(/Logs — success/i)).toBeInTheDocument());
  });

  it('logs header shows "Logs — failed" after a failed run', async () => {
    api.items.runFunctionScaffold.mockResolvedValue({
      success: false,
      output: null,
      logs: 'Error: something went wrong',
    });
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByText(/Logs — failed/i)).toBeInTheDocument());
  });

  it('shows error alert when runFunctionScaffold throws', async () => {
    api.items.runFunctionScaffold.mockRejectedValue(new Error('server error'));
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/Failed to reach the server/i)).toBeInTheDocument();
  });

  it('output and logs are cleared at the start of each run', async () => {
    api.items.runFunctionScaffold.mockResolvedValue({ success: true, output: '"first"', logs: '' });
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => screen.getByText('"first"'));

    api.items.runFunctionScaffold.mockResolvedValue({ success: true, output: '"second"', logs: '' });
    await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    await waitFor(() => screen.getByText('"second"'));
    expect(screen.queryByText('"first"')).not.toBeInTheDocument();
  });

  // ── Button states ─────────────────────────────────────────────────────────

  it('Run button shows "Running…" while the request is in flight', async () => {
    api.items.runFunctionScaffold.mockReturnValue(new Promise(() => {}));
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^Run$/ }));
    expect(screen.getByRole('button', { name: /Running…/i })).toBeInTheDocument();
  });

  it('Close button calls onClose', async () => {
    const { onClose } = await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^Close$/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
