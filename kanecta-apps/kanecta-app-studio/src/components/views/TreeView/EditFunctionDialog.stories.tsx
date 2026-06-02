import type { Meta, StoryObj } from '@storybook/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { fn, userEvent, within, waitFor, expect } from 'storybook/test';
import { EditFunctionDialog } from './EditFunctionDialog';
import { useWorkspaceStore } from '../../../store/workspace';
import type { KanectaItem } from '../../../types/kanecta';

const theme = createTheme();

const meta: Meta<typeof EditFunctionDialog> = {
  component: EditFunctionDialog,
  title: 'Views/TreeView/EditFunctionDialog',
  decorators: [
    (Story) => (
      <ThemeProvider theme={theme}>
        <Story />
      </ThemeProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof EditFunctionDialog>;

const functionItem: KanectaItem = {
  id: 'fn-1',
  value: 'fetchUser',
  type: 'function',
  confidence: 'high',
  sortOrder: 0,
  tags: [],
  childCount: 0,
  createdAt: new Date().toISOString(),
  modifiedAt: new Date().toISOString(),
};

const getObjectSpy = fn();
const saveObjectSpy = fn();

function mockApi(data: Record<string, unknown> | null, saveDelay = 0) {
  getObjectSpy.mockResolvedValue(data);
  saveObjectSpy.mockImplementation(() =>
    saveDelay > 0
      ? new Promise((r) => setTimeout(() => r({ ok: true }), saveDelay))
      : Promise.resolve({ ok: true }),
  );
  useWorkspaceStore.setState({
    getApi: (() => ({
      items: { getFunctionData: getObjectSpy, saveFunctionData: saveObjectSpy },
    })) as unknown as ReturnType<typeof useWorkspaceStore.getState>['getApi'],
  });
}

// ─── Data fixtures ────────────────────────────────────────────────────────────

const minimalData = {
  parameters: [],
  returnType: 'void',
};

const fetchUserData = {
  description: 'Fetch a user by ID from the API.',
  async: true,
  ai: false,
  typeParameters: [
    { name: 'T', constraint: 'extends User', default: 'User' },
  ],
  parameters: [
    { name: 'id', type: 'string', description: 'The user UUID.' },
    { name: 'options', typeId: 'c3d4e5f6-a7b8-9012-cdef-123456789012', optional: true, description: 'Fetch options.' },
  ],
  returnType: 'Promise<T>',
  throws: [
    { type: 'NotFoundError', description: 'When no user exists with that ID.' },
  ],
  body: "const res = await fetch(`/api/users/${id}`);\nif (!res.ok) throw new NotFoundError(id);\nreturn res.json() as T;",
};

const summariseData = {
  description: 'Summarise a document using AI.',
  async: true,
  ai: true,
  skill: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  parameters: [
    { name: 'document', type: 'string', description: 'Raw document text to summarise.' },
    { name: 'maxWords', type: 'number', optional: true, defaultValue: '200' },
  ],
  returnType: 'Promise<string>',
};

const kanectaTypedData = {
  description: 'Create a contact from a Kanecta-typed input.',
  async: true,
  ai: false,
  parameters: [
    { name: 'contact', typeId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'Contact data.' },
  ],
  returnTypeId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
};

const deprecatedData = {
  description: 'Old way to fetch users.',
  parameters: [{ name: 'id', type: 'string' }],
  returnType: 'User',
  deprecated: 'Use fetchUser<T> instead.',
};

// ─── Stories ─────────────────────────────────────────────────────────────────

export const Empty: Story = {
  name: 'Empty — new function (no existing data)',
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async () => {
    mockApi(null);
  },
};

export const Minimal: Story = {
  name: 'Minimal — parameters: [], returnType: void',
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async () => {
    mockApi(minimalData);
  },
};

export const WithPrimitiveParameters: Story = {
  name: 'With primitive parameters and type parameter',
  render: () => (
    <EditFunctionDialog open item={{ ...functionItem, value: 'fetchUser' }} onClose={() => {}} />
  ),
  play: async () => {
    mockApi(fetchUserData);
  },
};

export const AsyncWithAIAndSkill: Story = {
  name: 'Async + AI + skill UUID',
  render: () => (
    <EditFunctionDialog open item={{ ...functionItem, value: 'summarise' }} onClose={() => {}} />
  ),
  play: async () => {
    mockApi(summariseData);
  },
};

export const WithKanectaTypedParams: Story = {
  name: 'Kanecta-typed parameter and return type',
  render: () => (
    <EditFunctionDialog open item={{ ...functionItem, value: 'createContact' }} onClose={() => {}} />
  ),
  play: async () => {
    mockApi(kanectaTypedData);
  },
};

export const Deprecated: Story = {
  name: 'Deprecated function',
  render: () => (
    <EditFunctionDialog open item={{ ...functionItem, value: 'getUser' }} onClose={() => {}} />
  ),
  play: async () => {
    mockApi(deprecatedData);
  },
};

// ─── Interaction tests ────────────────────────────────────────────────────────

export const SaveDisabledWhenReturnTypeEmpty: Story = {
  name: 'Save is disabled when returnType is empty',
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi({ parameters: [], returnType: '' });
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Save' })).toBeTruthy());
    const saveBtn = canvas.getByRole('button', { name: 'Save' });
    await expect(saveBtn).toBeDisabled();
  },
};

export const SaveEnabledWithValidData: Story = {
  name: 'Save is enabled when form is valid',
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(minimalData);
    const canvas = within(canvasElement);
    await waitFor(() => {
      const btn = canvas.getByRole('button', { name: 'Save' });
      expect(btn).not.toBeDisabled();
    });
  },
};

export const SaveCallsSaveObject: Story = {
  name: 'Save calls saveObject with form data',
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    saveObjectSpy.mockClear();
    mockApi(minimalData);
    const canvas = within(canvasElement);

    await waitFor(() => {
      const btn = canvas.getByRole('button', { name: 'Save' });
      expect(btn).not.toBeDisabled();
    });

    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveObjectSpy).toHaveBeenCalledOnce());
    const [id, data] = saveObjectSpy.mock.calls[0] as [string, Record<string, unknown>];
    await expect(id).toBe('fn-1');
    await expect(data.returnType).toBe('void');
  },
};

export const AddAndRemoveParameter: Story = {
  name: 'Add parameter row, fill name + type, remove it',
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(minimalData);
    const canvas = within(canvasElement);

    // Add a parameter
    await waitFor(() => canvas.getByRole('button', { name: /add parameter/i }));
    await userEvent.click(canvas.getByRole('button', { name: /add parameter/i }));

    // Fill the name field (last input labelled "Name")
    const nameInputs = canvas.getAllByRole('textbox', { name: /^Name$/i });
    const newName = nameInputs[nameInputs.length - 1];
    await userEvent.clear(newName);
    await userEvent.type(newName, 'myParam');

    // Remove it — find the delete IconButton inside the parameter box
    const paramSection = canvasElement.querySelector('.MuiBox-root');
    if (paramSection) {
      const btn = paramSection.querySelector('button:last-of-type') as HTMLButtonElement | null;
      if (btn) await userEvent.click(btn);
    }

    // Parameter should be gone
    await waitFor(() => {
      const inputs = canvas.queryAllByRole('textbox', { name: /^Name$/i });
      expect(inputs).toHaveLength(0);
    });
  },
};

export const SwitchReturnTypeToKanecta: Story = {
  name: 'Switching return type to Kanecta type shows UUID field',
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(minimalData);
    const canvas = within(canvasElement);

    // Wait for form to load then switch to Kanecta type
    await waitFor(() => canvas.getAllByRole('radio'));
    const kanectaRadios = canvas.getAllByRole('radio', { name: /kanecta type/i });
    // The last one is the return type section
    const returnKanectaRadio = kanectaRadios[kanectaRadios.length - 1];
    await userEvent.click(returnKanectaRadio);

    // UUID field appears
    await waitFor(() => expect(canvas.getByRole('textbox', { name: /return type uuid/i })).toBeTruthy());
  },
};
