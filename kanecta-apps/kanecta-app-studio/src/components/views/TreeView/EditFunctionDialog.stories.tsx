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
      items: {
        getFunctionData: getObjectSpy,
        saveFunctionData: saveObjectSpy,
        checkFunctionScaffold: () => Promise.resolve({ exists: true, stale: false }),
        getFunctionPackageJson: () => Promise.resolve(null),
      },
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
  decorators: [(Story) => { mockApi(null); return <Story />; }],
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
};

export const Minimal: Story = {
  name: 'Minimal — parameters: [], returnType: void',
  decorators: [(Story) => { mockApi(minimalData); return <Story />; }],
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
};

export const WithPrimitiveParameters: Story = {
  name: 'With primitive parameters and type parameter',
  decorators: [(Story) => { mockApi(fetchUserData); return <Story />; }],
  render: () => (
    <EditFunctionDialog open item={{ ...functionItem, value: 'fetchUser' }} onClose={() => {}} />
  ),
};

export const AsyncWithAIAndSkill: Story = {
  name: 'Async + AI + skill UUID',
  decorators: [(Story) => { mockApi(summariseData); return <Story />; }],
  render: () => (
    <EditFunctionDialog open item={{ ...functionItem, value: 'summarise' }} onClose={() => {}} />
  ),
};

export const WithKanectaTypedParams: Story = {
  name: 'Kanecta-typed parameter and return type',
  decorators: [(Story) => { mockApi(kanectaTypedData); return <Story />; }],
  render: () => (
    <EditFunctionDialog open item={{ ...functionItem, value: 'createContact' }} onClose={() => {}} />
  ),
};

export const Deprecated: Story = {
  name: 'Deprecated function',
  decorators: [(Story) => { mockApi(deprecatedData); return <Story />; }],
  render: () => (
    <EditFunctionDialog open item={{ ...functionItem, value: 'getUser' }} onClose={() => {}} />
  ),
};

// ─── Interaction tests ────────────────────────────────────────────────────────

export const SaveDisabledWhenReturnTypeEmpty: Story = {
  name: 'Save is disabled when returnType is empty',
  decorators: [(Story) => { mockApi({ parameters: [], returnType: '' }); return <Story />; }],
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = within(document.body).getByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy());
    await expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  },
};

export const SaveEnabledWithValidData: Story = {
  name: 'Save is enabled when form is valid',
  decorators: [(Story) => { mockApi(minimalData); return <Story />; }],
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = within(document.body).getByRole('dialog');
    await waitFor(() => {
      const btn = within(dialog).getByRole('button', { name: 'Save' });
      expect(btn).not.toBeDisabled();
    });
  },
};

export const SaveCallsSaveObject: Story = {
  name: 'Save calls saveObject with form data',
  decorators: [(Story) => { saveObjectSpy.mockClear(); mockApi(minimalData); return <Story />; }],
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = within(document.body).getByRole('dialog');

    await waitFor(() => {
      const btn = within(dialog).getByRole('button', { name: 'Save' });
      expect(btn).not.toBeDisabled();
    });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveObjectSpy).toHaveBeenCalledOnce());
    const [id, data] = saveObjectSpy.mock.calls[0] as [string, Record<string, unknown>];
    await expect(id).toBe('fn-1');
    await expect(data.returnType).toBe('void');
  },
};

export const AddAndRemoveParameter: Story = {
  name: 'Add parameter row, fill name + type, remove it',
  decorators: [(Story) => { mockApi(minimalData); return <Story />; }],
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = within(document.body).getByRole('dialog');

    await waitFor(() => within(dialog).getByRole('button', { name: /add parameter/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: /add parameter/i }));

    const nameInputs = within(dialog).getAllByRole('textbox', { name: /^Name$/i });
    await expect(nameInputs.length).toBeGreaterThan(0);
    const newName = nameInputs[nameInputs.length - 1];
    await userEvent.clear(newName);
    await userEvent.type(newName, 'myParam');

    await userEvent.click(within(dialog).getByRole('button', { name: /remove parameter/i }));

    await waitFor(() => {
      const inputs = within(dialog).queryAllByRole('textbox', { name: /^Name$/i });
      expect(inputs).toHaveLength(0);
    });
  },
};

export const SwitchReturnTypeToKanecta: Story = {
  name: 'Switching return type to Kanecta type shows UUID field',
  decorators: [(Story) => { mockApi(minimalData); return <Story />; }],
  render: () => (
    <EditFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = within(document.body).getByRole('dialog');

    await waitFor(() => within(dialog).getAllByRole('radio'));
    const kanectaRadios = within(dialog).getAllByRole('radio', { name: /kanecta type/i });
    const returnKanectaRadio = kanectaRadios[kanectaRadios.length - 1];
    await userEvent.click(returnKanectaRadio);

    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: /return type uuid/i })).toBeTruthy());
  },
};
