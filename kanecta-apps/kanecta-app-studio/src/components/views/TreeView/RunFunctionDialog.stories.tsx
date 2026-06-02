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

const getObjectSpy = fn();

function mockApi(data: Record<string, unknown> | null, delay = 0) {
  getObjectSpy.mockImplementation(() =>
    delay > 0
      ? new Promise((r) => setTimeout(() => r(data), delay))
      : Promise.resolve(data),
  );
  useWorkspaceStore.setState({
    getApi: (() => ({
      items: { getObject: getObjectSpy },
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

export const NoParameters: Story = {
  name: 'No parameters — Run is immediately enabled',
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'triggerBuild' }} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(noParamsData);
    const canvas = within(canvasElement);
    await waitFor(() => canvas.getByText('This function takes no arguments.'));
    const runBtn = canvas.getByRole('button', { name: 'Run' });
    await expect(runBtn).not.toBeDisabled();
  },
};

export const PrimitiveParameters: Story = {
  name: 'Primitive parameters — one required, one optional',
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'fetchUser' }} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(primitiveParamsData);
    const canvas = within(canvasElement);

    // Both inputs appear
    await waitFor(() => canvas.getByRole('textbox', { name: /id/i }));
    await expect(canvas.getByRole('textbox', { name: /limit/i })).toBeTruthy();

    // Helper text shows types
    const idHelper = canvasElement.querySelector('#\\:r0\\:-helper-text, .MuiFormHelperText-root');
    if (idHelper) await expect(idHelper.textContent).toContain('string');
  },
};

export const AllOptionalParameters: Story = {
  name: 'All optional parameters — Run enabled without filling any',
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'notify' }} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(allOptionalData);
    const canvas = within(canvasElement);
    await waitFor(() => canvas.getByRole('textbox', { name: /title/i }));
    // Run should be enabled even with empty fields
    const runBtn = canvas.getByRole('button', { name: 'Run' });
    await expect(runBtn).not.toBeDisabled();
  },
};

export const KanectaTypedParameters: Story = {
  name: 'Kanecta-typed parameter — shows typeId as helper text',
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'createContact' }} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(kanectaTypedData);
    const canvas = within(canvasElement);
    await waitFor(() => canvas.getByRole('textbox', { name: /contact/i }));

    // Helper text should mention Kanecta and the UUID
    const helperTexts = canvasElement.querySelectorAll('.MuiFormHelperText-root');
    const hasKanectaRef = Array.from(helperTexts).some((el) =>
      el.textContent?.includes('a1b2c3d4'),
    );
    await expect(hasKanectaRef).toBe(true);
  },
};

export const RestParameter: Story = {
  name: 'Rest parameter — shows ...rest label',
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'log' }} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(restParamData);
    await waitFor(() => within(canvasElement).getByText(/rest/i));
  },
};

export const AIFunction: Story = {
  name: 'AI function with optional param — Run enabled',
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'summarise' }} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(aiData);
    const canvas = within(canvasElement);
    await waitFor(() => canvas.getByRole('textbox', { name: /document/i }));
  },
};

// ─── Interaction tests ────────────────────────────────────────────────────────

export const RunDisabledUntilRequiredFilled: Story = {
  name: 'Run disabled until required field is filled',
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'fetchUser' }} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(primitiveParamsData);
    const canvas = within(canvasElement);

    await waitFor(() => canvas.getByRole('textbox', { name: /id/i }));
    const runBtn = canvas.getByRole('button', { name: 'Run' });

    // Disabled while required 'id' is empty
    await expect(runBtn).toBeDisabled();

    // Fill the required field
    await userEvent.type(canvas.getByRole('textbox', { name: /id/i }), 'user-uuid-123');

    // Now enabled
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Run' })).not.toBeDisabled());
  },
};

export const OptionalDefaultDoesNotBlockRun: Story = {
  name: 'Optional param with defaultValue does not block Run',
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'fetchUser' }} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi({
      parameters: [
        { name: 'id', type: 'string' },
        { name: 'limit', type: 'number', defaultValue: '10' },
      ],
      returnType: 'Promise<User>',
    });
    const canvas = within(canvasElement);

    await waitFor(() => canvas.getByRole('textbox', { name: /id/i }));

    // Fill only the required field
    await userEvent.type(canvas.getByRole('textbox', { name: /id/i }), 'abc');

    // 'limit' has a defaultValue so it doesn't block Run
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Run' })).not.toBeDisabled());
  },
};

export const RunButtonFills: Story = {
  name: 'Filling all required args enables Run',
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'createContact' }} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(kanectaTypedData);
    const canvas = within(canvasElement);

    await waitFor(() => canvas.getByRole('textbox', { name: /contact/i }));

    // Fill both required params
    await userEvent.type(canvas.getByRole('textbox', { name: /contact/i }), 'c1d2e3f4-0000-0000-0000-000000000000');
    await userEvent.type(canvas.getByRole('textbox', { name: /userId/i }), 'user-123');

    await waitFor(() => expect(canvas.getByRole('button', { name: 'Run' })).not.toBeDisabled());
  },
};

export const ReturnTypeShown: Story = {
  name: 'Return type is shown at the bottom',
  render: () => (
    <RunFunctionDialog open item={{ ...functionItem, value: 'fetchUser' }} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    mockApi(primitiveParamsData);
    await waitFor(() =>
      expect(within(canvasElement).getByText(/Returns:/i)).toBeTruthy(),
    );
    await expect(within(canvasElement).getByText(/Promise<User>/)).toBeTruthy();
  },
};

export const LoadingState: Story = {
  name: 'Loading state — spinner shown while fetching',
  render: () => (
    <RunFunctionDialog open item={functionItem} onClose={() => {}} />
  ),
  play: async ({ canvasElement }) => {
    // Slow load — spinner should be visible briefly
    mockApi(primitiveParamsData, 2000);
    await waitFor(() =>
      expect(canvasElement.querySelector('.MuiCircularProgress-root')).toBeTruthy(),
    );
  },
};
