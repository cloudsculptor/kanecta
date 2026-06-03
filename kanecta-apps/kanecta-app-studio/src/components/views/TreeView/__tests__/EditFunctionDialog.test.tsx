import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { EditFunctionDialog } from '../EditFunctionDialog';
import type { KanectaItem } from '../../../../types/kanecta';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// getApi must be a stable reference — if it changes every render it becomes a
// useEffect dependency that re-fires the load, keeping the spinner forever.

const { api, getApi } = vi.hoisted(() => {
  const api = {
    items: {
      getFunctionData: vi.fn(),
      checkFunctionScaffold: vi.fn(),
      saveFunctionData: vi.fn(),
      compileFunctionScaffold: vi.fn(),
    },
  };
  const getApi = () => api;
  return { api, getApi };
});

vi.mock('../../../../store/workspace', () => ({
  useWorkspaceStore: () => ({ getApi }),
}));

vi.mock('../BodyConflictDialog', () => ({
  BodyConflictDialog: ({ open, onUseForm, onUseDisk }: {
    open: boolean; onUseForm: () => void; onUseDisk: () => void;
    onClose: () => void; diskBody: string; formBody: string;
  }) =>
    open ? (
      <div data-testid="body-conflict-dialog">
        <button onClick={onUseForm}>Use form body</button>
        <button onClick={onUseDisk}>Use disk body</button>
      </div>
    ) : null,
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const theme = createTheme();
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
);

const mockItem: KanectaItem = {
  id: '12345678-1234-1234-1234-123456789abc',
  value: 'myFunction',
  type: 'function',
  confidence: null,
  sortOrder: 0,
  tags: [],
  createdAt: null,
  modifiedAt: null,
};

const emptyFnData = {
  async: false,
  ai: false,
  parameters: [],
  returnType: 'void',
  throws: [],
};

const richFnData = {
  description: 'Does something useful',
  async: true,
  ai: false,
  parameters: [
    { name: 'input', type: 'string' },
    { name: 'count', type: 'number', optional: true },
  ],
  returnType: 'boolean',
  throws: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function renderDialog(
  props: Partial<{ open: boolean; onClose: () => void; item: KanectaItem }> = {},
) {
  const onClose = vi.fn();
  render(
    <EditFunctionDialog open={true} onClose={onClose} item={mockItem} {...props} />,
    { wrapper: Wrapper },
  );
  await waitFor(
    () => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
    { timeout: 3000 },
  );
  return { onClose };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EditFunctionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.items.getFunctionData.mockResolvedValue(null);
    api.items.checkFunctionScaffold.mockResolvedValue({ exists: false });
    api.items.saveFunctionData.mockResolvedValue({ ok: true });
    api.items.compileFunctionScaffold.mockResolvedValue({ success: true, output: '' });
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('shows the dialog title with item name', async () => {
    await renderDialog();
    expect(screen.getByText('Edit function')).toBeInTheDocument();
    expect(screen.getByText('myFunction')).toBeInTheDocument();
  });

  it('shows a loading spinner while fetching', () => {
    api.items.getFunctionData.mockReturnValue(new Promise(() => {}));
    api.items.checkFunctionScaffold.mockReturnValue(new Promise(() => {}));
    render(<EditFunctionDialog open={true} onClose={vi.fn()} item={mockItem} />, { wrapper: Wrapper });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows the form once data has loaded', async () => {
    await renderDialog();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByText('Generated code')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <EditFunctionDialog open={false} onClose={vi.fn()} item={mockItem} />,
      { wrapper: Wrapper },
    );
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  // ── Data loading ────────────────────────────────────────────────────────────

  it('calls getFunctionData and checkFunctionScaffold with item id', async () => {
    await renderDialog();
    expect(api.items.getFunctionData).toHaveBeenCalledWith(mockItem.id);
    expect(api.items.checkFunctionScaffold).toHaveBeenCalledWith(mockItem.id);
  });

  it('populates description from loaded function data', async () => {
    api.items.getFunctionData.mockResolvedValue(richFnData);
    await renderDialog();
    // richFnData has 2 params each with a Description sub-field — take the first (main) one
    expect(screen.getAllByLabelText('Description')[0]).toHaveValue('Does something useful');
  });

  it('turns on Async switch from loaded data', async () => {
    api.items.getFunctionData.mockResolvedValue(richFnData);
    await renderDialog();
    // MUI Switch renders as input[type="checkbox"]; first checkbox = Async
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes[0]).toBeChecked();
  });

  it('shows empty form when getFunctionData returns null', async () => {
    await renderDialog();
    expect(screen.getByLabelText('Description')).toHaveValue('');
  });

  it('populates parameter rows from loaded data', async () => {
    api.items.getFunctionData.mockResolvedValue(richFnData);
    await renderDialog();
    expect(screen.getByDisplayValue('input')).toBeInTheDocument();
    expect(screen.getByDisplayValue('count')).toBeInTheDocument();
  });

  it('resets compile result when dialog reopens', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    api.items.compileFunctionScaffold.mockResolvedValue({ success: true, output: 'ok' });
    const { rerender } = render(
      <EditFunctionDialog open={true} onClose={vi.fn()} item={mockItem} />,
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(), { timeout: 3000 });
    await userEvent.click(screen.getByRole('button', { name: /Save & Compile/i }));
    await waitFor(() => expect(screen.getByText('Build succeeded')).toBeInTheDocument());

    rerender(<ThemeProvider theme={theme}><EditFunctionDialog open={false} onClose={vi.fn()} item={mockItem} /></ThemeProvider>);
    rerender(<ThemeProvider theme={theme}><EditFunctionDialog open={true} onClose={vi.fn()} item={mockItem} /></ThemeProvider>);
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.queryByText('Build succeeded')).not.toBeInTheDocument();
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it('Save button is disabled when return type is empty', async () => {
    api.items.getFunctionData.mockResolvedValue({ ...emptyFnData, returnType: '' });
    await renderDialog();
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled();
  });

  it('Save button is enabled when form is valid', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    await renderDialog();
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
  });

  it('Save disabled when a parameter has no name', async () => {
    api.items.getFunctionData.mockResolvedValue({
      ...emptyFnData,
      parameters: [{ name: '', type: 'string' }],
    });
    await renderDialog();
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled();
  });

  // ── Type parameters ─────────────────────────────────────────────────────────

  it('adds a type parameter row when the Type Parameters Add is clicked', async () => {
    await renderDialog();
    // The Type Parameters section has the first "Add" button in the dialog
    const addButtons = screen.getAllByRole('button', { name: /^Add$/ });
    await userEvent.click(addButtons[0]);
    expect(screen.getByPlaceholderText('T')).toBeInTheDocument();
  });

  it('removes a type parameter row when delete is clicked', async () => {
    api.items.getFunctionData.mockResolvedValue({
      ...emptyFnData,
      typeParameters: [{ name: 'T' }],
    });
    await renderDialog();
    expect(screen.getByDisplayValue('T')).toBeInTheDocument();
    const deleteBtn = document.querySelector('[data-testid="DeleteIcon"]')!.closest('button')!;
    await userEvent.click(deleteBtn);
    await waitFor(() => expect(screen.queryByDisplayValue('T')).not.toBeInTheDocument());
  });

  // ── Parameters ──────────────────────────────────────────────────────────────

  it('adds a parameter row when Add parameter is clicked', async () => {
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /Add parameter/i }));
    // A Name field appears in the new parameter row
    expect(screen.getAllByLabelText(/^Name \*/i).length).toBeGreaterThan(0);
  });

  it('removes a parameter row when delete is clicked', async () => {
    api.items.getFunctionData.mockResolvedValue({
      ...emptyFnData,
      parameters: [{ name: 'myParam', type: 'string' }],
    });
    await renderDialog();
    expect(screen.getByDisplayValue('myParam')).toBeInTheDocument();
    const deleteBtn = document.querySelector('[data-testid="DeleteIcon"]')!.closest('button')!;
    await userEvent.click(deleteBtn);
    await waitFor(() => expect(screen.queryByDisplayValue('myParam')).not.toBeInTheDocument());
  });

  // ── Throws ──────────────────────────────────────────────────────────────────

  it('adds a throw row when the Throws Add is clicked', async () => {
    await renderDialog();
    const addButtons = screen.getAllByRole('button', { name: /^Add$/ });
    await userEvent.click(addButtons[addButtons.length - 1]);
    expect(screen.getByPlaceholderText('Error')).toBeInTheDocument();
  });

  it('removes a throw row when delete is clicked', async () => {
    api.items.getFunctionData.mockResolvedValue({
      ...emptyFnData,
      throws: [{ type: 'TypeError', description: 'bad input' }],
    });
    await renderDialog();
    expect(screen.getByDisplayValue('TypeError')).toBeInTheDocument();
    const deleteBtn = document.querySelector('[data-testid="DeleteIcon"]')!.closest('button')!;
    await userEvent.click(deleteBtn);
    await waitFor(() => expect(screen.queryByDisplayValue('TypeError')).not.toBeInTheDocument());
  });

  // ── Save ────────────────────────────────────────────────────────────────────

  it('calls saveFunctionData with correct payload on Save', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() =>
      expect(api.items.saveFunctionData).toHaveBeenCalledWith(
        mockItem.id,
        expect.objectContaining({ returnType: 'void' }),
      ),
    );
  });

  it('includes description in save payload when typed', async () => {
    await renderDialog();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'My description' } });
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() =>
      expect(api.items.saveFunctionData).toHaveBeenCalledWith(
        mockItem.id,
        expect.objectContaining({ description: 'My description' }),
      ),
    );
  });

  it('shows error alert when save fails', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    api.items.saveFunctionData.mockRejectedValue(new Error('network error'));
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/Failed to save/i)).toBeInTheDocument();
  });

  it('does NOT show dirty warning when scaffold does not exist', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    api.items.checkFunctionScaffold.mockResolvedValue({ exists: false });
    await renderDialog();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'change' } });
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(api.items.saveFunctionData).toHaveBeenCalled());
    expect(screen.queryByText('Overwrite generated code?')).not.toBeInTheDocument();
  });

  it('shows dirty warning when scaffold exists and form is changed', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    api.items.checkFunctionScaffold.mockResolvedValue({ exists: true });
    await renderDialog();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'change' } });
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByText('Overwrite generated code?')).toBeInTheDocument());
  });

  it('Cancel on dirty warning aborts save', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    api.items.checkFunctionScaffold.mockResolvedValue({ exists: true });
    await renderDialog();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'change' } });
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => screen.getByText('Overwrite generated code?'));
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(api.items.saveFunctionData).not.toHaveBeenCalled();
  });

  it('Save anyway on dirty warning proceeds to save', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    api.items.checkFunctionScaffold.mockResolvedValue({ exists: true });
    await renderDialog();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'change' } });
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => screen.getByText('Overwrite generated code?'));
    await userEvent.click(screen.getByRole('button', { name: /Save anyway/i }));
    await waitFor(() => expect(api.items.saveFunctionData).toHaveBeenCalled());
  });

  // ── Save & Compile ──────────────────────────────────────────────────────────

  it('Save & Compile calls saveFunctionData then compileFunctionScaffold', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /Save & Compile/i }));
    await waitFor(() => expect(api.items.compileFunctionScaffold).toHaveBeenCalledWith(mockItem.id));
    expect(api.items.saveFunctionData).toHaveBeenCalled();
  });

  it('shows Build succeeded in right panel on successful compile', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    api.items.compileFunctionScaffold.mockResolvedValue({ success: true, output: 'Done.' });
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /Save & Compile/i }));
    await waitFor(() => expect(screen.getByText('Build succeeded')).toBeInTheDocument());
  });

  it('shows Build failed in right panel on failed compile', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    api.items.compileFunctionScaffold.mockResolvedValue({
      success: false,
      output: 'error TS2345: Argument of type...',
    });
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /Save & Compile/i }));
    await waitFor(() => expect(screen.getByText('Build failed')).toBeInTheDocument());
    expect(screen.getByText(/error TS2345/)).toBeInTheDocument();
  });

  it('shows error when save step of Save & Compile fails', async () => {
    api.items.getFunctionData.mockResolvedValue(emptyFnData);
    api.items.saveFunctionData.mockRejectedValue(new Error('disk full'));
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /Save & Compile/i }));
    await waitFor(() => expect(screen.getByText(/Failed to save/i)).toBeInTheDocument());
    expect(api.items.compileFunctionScaffold).not.toHaveBeenCalled();
  });

  // ── Close ───────────────────────────────────────────────────────────────────

  it('Close action button calls onClose', async () => {
    const { onClose } = await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /^Close$/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it('title close icon button calls onClose', async () => {
    const { onClose } = await renderDialog();
    // The icon-only button in the title bar (no text content)
    const iconButtons = screen.getAllByRole('button').filter((b) => !b.textContent?.trim());
    await userEvent.click(iconButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });

  // ── Code preview ────────────────────────────────────────────────────────────

  it('shows the function name derived from item value in the code preview', async () => {
    await renderDialog();
    const pres = Array.from(document.querySelectorAll('pre'));
    expect(pres.some((p) => p.textContent?.includes('function myFunction'))).toBe(true);
  });

  it('code preview includes async keyword when Async is toggled on', async () => {
    await renderDialog();
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    await userEvent.click(checkboxes[0] as HTMLElement);
    await waitFor(() => {
      const pres = Array.from(document.querySelectorAll('pre'));
      expect(pres.some((p) => p.textContent?.includes('async function'))).toBe(true);
    });
  });

  it('code preview reflects a parameter added via the form', async () => {
    await renderDialog();
    await userEvent.click(screen.getByRole('button', { name: /Add parameter/i }));
    await waitFor(() => {
      const pres = Array.from(document.querySelectorAll('pre'));
      // After adding a param the preview should no longer be zero-arg
      expect(pres.some((p) => p.textContent?.includes('('))).toBe(true);
    });
  });

  it('code preview shows void return type by default', async () => {
    await renderDialog();
    const pres = Array.from(document.querySelectorAll('pre'));
    expect(pres.some((p) => p.textContent?.includes('): void {'))).toBe(true);
  });
});
