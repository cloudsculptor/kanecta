import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeycloakContext } from '../../auth/KeycloakProvider';
import { AppShell } from './AppShell';

// AUTH_DISABLED mode is the only auth state safely story-able without a real
// Keycloak instance to redirect to (the signed-out/"Log in" and signed-in
// states call into keycloak-js directly via the AccountIndicator's onClick
// handlers). This mirrors how Studio's AccountMenu.stories.tsx documents
// which auth states are and aren't practical to render in isolation.
const meta: Meta<typeof AppShell> = {
  title: 'Shell/AppShell',
  component: AppShell,
  decorators: [
    (Story) => (
      <KeycloakContext.Provider value={{ initialized: true, authenticated: true, authDisabled: true }}>
        <Story />
      </KeycloakContext.Provider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AppShell>;

export const AuthDisabled: Story = {};
