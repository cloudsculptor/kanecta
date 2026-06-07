import type { Meta, StoryObj } from '@storybook/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { AccountMenu } from './AccountMenu';
import { KeycloakContext } from '../../auth/KeycloakProvider';
import keycloak from '../../auth/keycloak';

const theme = createTheme({ colorSchemes: { dark: true } });

const meta: Meta<typeof AccountMenu> = {
  component: AccountMenu,
  title: 'Shell/AccountMenu',
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <ThemeProvider theme={theme}>
        <div style={{ background: '#535754', padding: 16 }}>
          <Story />
        </div>
      </ThemeProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof AccountMenu>;

export const LoggedOut: Story = {
  decorators: [
    (Story) => (
      <KeycloakContext.Provider value={{ initialized: true, authenticated: false, authDisabled: false }}>
        <Story />
      </KeycloakContext.Provider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  },
};

export const LoggedIn: Story = {
  decorators: [
    (Story) => {
      keycloak.tokenParsed = { realm_access: { roles: ['admin'] } };
      keycloak.idTokenParsed = { given_name: 'Kanecta Admin', email: 'kanecta-admin@example.com' };
      return (
        <KeycloakContext.Provider value={{ initialized: true, authenticated: true, authDisabled: false }}>
          <Story />
        </KeycloakContext.Provider>
      );
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Account menu' });
    await expect(trigger).toBeInTheDocument();

    await userEvent.click(trigger);
    const body = within(document.body);
    await waitFor(() => body.getByText('kanecta-admin@example.com'));
    await expect(body.getByText('admin')).toBeInTheDocument();
    await expect(body.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  },
};

export const AuthDisabled: Story = {
  decorators: [
    (Story) => (
      <KeycloakContext.Provider value={{ initialized: true, authenticated: true, authDisabled: true }}>
        <Story />
      </KeycloakContext.Provider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Log in' })).not.toBeInTheDocument();
  },
};
