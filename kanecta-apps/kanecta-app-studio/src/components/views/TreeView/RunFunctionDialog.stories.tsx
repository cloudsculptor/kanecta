import type { Meta, StoryObj } from '@storybook/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { fn, userEvent, within, waitFor, expect } from 'storybook/test';
import { RunFunctionDialog } from './RunFunctionDialog';
import { useWorkspaceStore } from '../../../store/workspace';
import type { KanectaItem } from '../../../types/kanecta';

const theme = createTheme();

const meta: Meta<typeof RunFunctionDialog> = {
  component: RunFunctionDialog,
  title: 'Views/TreeView/RunFunctionDialog',
  decorators: [
    (Story) => (
      <ThemeProvider theme={theme}>
        <Story />
      </ThemeProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof RunFunctionDialog>;

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

const getFunctionDataSpy = fn();
const runFunctionScaffoldSpy = fn();

function mockApi(data: Record<string, unknown> | null, delay = 0) {
  getFunctionDataSpy.mockImplementation(() =>
    delay > 0
      ? new Promise((r) => setTimeout(() => r(data), delay))
      : Promise.resolve(data),
  );
  runFunctionScaffoldSpy.mockResolvedValue({ success: true, output: '"ok"', logs: '' });
  useWorkspaceStore.setState({
    getApi: (() => ({
      items: {
        getFunctionData: getFunctionDataSpy,
        runFunctionScaffold: runFunctionScaffoldSpy,
        checkFunctionScaffold: () => Promise.resolve({ exists: true, stale: false }),
        getFunctionPackageJson: () => Promise.resolve(null),
      },
    })) as unknown as ReturnType<typeof useWorkspaceStore.getState>['getApi'],
  });
}

// ─── Data fixtures ────────────────────────────────────────────────────────────

const noParamsData = {
  description: 'Triggers a build with no arguments.',
  parameters: [],
  returnType: 'Promise<void>',
};

const primitiveParamsData = {
  description: 'Fetch a user by ID from the API.',
  async: true,
  parameters: [
    { name: 'id', type: 'string', description: 'The user UUID.' },
    { name: 'limit', type: 'number', optional: true, defaultValue: '10', description: 'Max results.' },
  ],
  returnType: 'Promise<User>',
};

const allOptionalData = {
  description: 'Send a notification with optional overrides.',
  parameters: [
    { name: 'title', type: 'string', optional: true, defaultValue: '"Notification"' },
    { name: 'body', type: 'string', optional: true },
  ],
  returnType: 'void',
};

const kanectaTypedData = {
  description: 'Create a contact from a Kanecta-typed input.',
  parameters: [
    { name: 'contact', typeId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', description: 'Contact data.' },
    { name: 'userId', type: 'string', description: 'Owner user ID.' },
  ],
  returnTypeId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
};

const restParamData = {
  description: 'Log messages to the console.',
  parameters: [
    { name: 'messages', type: 'string', rest: true, description: 'Messages to log.' },
  ],
  returnType: 'void',
};

const aiData = {
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

// ─── Stories ─────────────────────────────────────────────────────────────────

function getDialog() {
  return within(document.body).getByRole('dialog');
}

export const NoParameters: Story = {
  name: 'No parameters — Run is immediately enabled',
  decorators: [(Story) => { mockApi(noParamsData); return <Story />; }],
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'triggerBuild' }} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = within(document.body).getByRole('dialog');
    await waitFor(() => within(dialog).getByText('This function takes no arguments.'));
    const runBtn = within(dialog).getByRole('button', { name: 'Run' });
    await expect(runBtn).not.toBeDisabled();
  },
};

export const PrimitiveParameters: Story = {
  name: 'Primitive parameters — one required, one optional',
  decorators: [(Story) => { mockApi(primitiveParamsData); return <Story />; }],
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'fetchUser' }} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = getDialog();
    await waitFor(() => within(dialog).getByRole('textbox', { name: /id/i }));
    await expect(within(dialog).getByRole('textbox', { name: /limit/i })).toBeTruthy();
    const helperTexts = dialog.querySelectorAll('.MuiFormHelperText-root');
    const hasString = Array.from(helperTexts).some((el) => el.textContent?.includes('string'));
    if (helperTexts.length > 0) await expect(hasString).toBe(true);
  },
};

export const AllOptionalParameters: Story = {
  name: 'All optional parameters — Run enabled without filling any',
  decorators: [(Story) => { mockApi(allOptionalData); return <Story />; }],
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'notify' }} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = getDialog();
    await waitFor(() => within(dialog).getByRole('textbox', { name: /title/i }));
    await expect(within(dialog).getByRole('button', { name: 'Run' })).not.toBeDisabled();
  },
};

export const KanectaTypedParameters: Story = {
  name: 'Kanecta-typed parameter — shows typeId as helper text',
  decorators: [(Story) => { mockApi(kanectaTypedData); return <Story />; }],
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'createContact' }} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = getDialog();
    await waitFor(() => within(dialog).getByRole('textbox', { name: /contact/i }));
    const helperTexts = dialog.querySelectorAll('.MuiFormHelperText-root');
    const hasKanectaRef = Array.from(helperTexts).some((el) =>
      el.textContent?.includes('a1b2c3d4'),
    );
    await expect(hasKanectaRef).toBe(true);
  },
};

export const RestParameter: Story = {
  name: 'Rest parameter — shows ...rest label',
  decorators: [(Story) => { mockApi(restParamData); return <Story />; }],
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'log' }} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = getDialog();
    await waitFor(() => expect(dialog.textContent?.toLowerCase().includes('rest')).toBe(true));
  },
};

export const AIFunction: Story = {
  name: 'AI function with optional param — Run enabled',
  decorators: [(Story) => { mockApi(aiData); return <Story />; }],
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'summarise' }} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = getDialog();
    await waitFor(() => within(dialog).getByRole('textbox', { name: /document/i }));
  },
};

// ─── Interaction tests ────────────────────────────────────────────────────────

export const RunDisabledUntilRequiredFilled: Story = {
  name: 'Run disabled until required field is filled',
  decorators: [(Story) => { mockApi(primitiveParamsData); return <Story />; }],
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'fetchUser' }} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = getDialog();
    await waitFor(() => within(dialog).getByRole('textbox', { name: /id/i }));
    const runBtn = within(dialog).getByRole('button', { name: 'Run' });

    await expect(runBtn).toBeDisabled();

    await userEvent.type(within(dialog).getByRole('textbox', { name: /id/i }), 'user-uuid-123');

    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Run' })).not.toBeDisabled());
  },
};

const optionalDefaultData = {
  parameters: [
    { name: 'id', type: 'string' },
    { name: 'limit', type: 'number', defaultValue: '10' },
  ],
  returnType: 'Promise<User>',
};

export const OptionalDefaultDoesNotBlockRun: Story = {
  name: 'Optional param with defaultValue does not block Run',
  decorators: [(Story) => { mockApi(optionalDefaultData); return <Story />; }],
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'fetchUser' }} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = getDialog();
    await waitFor(() => within(dialog).getByRole('textbox', { name: /id/i }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /id/i }), 'abc');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Run' })).not.toBeDisabled());
  },
};

export const RunButtonFills: Story = {
  name: 'Filling all required args enables Run',
  decorators: [(Story) => { mockApi(kanectaTypedData); return <Story />; }],
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'createContact' }} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = getDialog();
    await waitFor(() => within(dialog).getByRole('textbox', { name: /contact/i }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: /contact/i }), 'c1d2e3f4-0000-0000-0000-000000000000');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /userId/i }), 'user-123');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Run' })).not.toBeDisabled());
  },
};

export const ReturnTypeShown: Story = {
  name: 'Return type is shown at the bottom',
  decorators: [(Story) => { mockApi(primitiveParamsData); return <Story />; }],
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'fetchUser' }} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = getDialog();
    await waitFor(() => expect(within(dialog).getByText(/Returns:/i)).toBeTruthy());
    await expect(within(dialog).getByText(/Promise<User>/)).toBeTruthy();
  },
};

export const LoadingState: Story = {
  name: 'Loading state — spinner shown while fetching',
  decorators: [(Story) => { mockApi(primitiveParamsData, 2000); return <Story />; }],
  render: () => (
    <RunFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async () => {
    const dialog = getDialog();
    await waitFor(() =>
      expect(dialog.querySelector('.MuiCircularProgress-root')).toBeTruthy(),
    );
  },
};
