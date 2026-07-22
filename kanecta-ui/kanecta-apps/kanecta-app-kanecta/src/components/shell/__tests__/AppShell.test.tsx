import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from '../AppShell';
import { KeycloakProvider, KeycloakContext } from '../../../auth/KeycloakProvider';

// VITE_AUTH_DISABLED is not set to "true" in the test env, so KeycloakProvider
// runs its real (non-disabled) branch here — matching how the app actually
// boots when a Keycloak instance is configured. The AUTH_DISABLED-mode test
// below simulates that mode explicitly via KeycloakContext.Provider rather
// than relying on env var stubbing, since import.meta.env is frozen at build
// time by Vite.
describe('AppShell', () => {
  it('renders the app title', () => {
    render(
      <KeycloakProvider>
        <AppShell />
      </KeycloakProvider>
    );
    expect(screen.getByRole('heading', { name: 'Kanecta' })).toBeInTheDocument();
  });

  it('renders an empty content host region', () => {
    render(
      <KeycloakProvider>
        <AppShell />
      </KeycloakProvider>
    );
    const content = screen.getByTestId('AppShell__content');
    expect(content).toBeInTheDocument();
    expect(content).toBeEmptyDOMElement();
  });

  it('shows the "Log in" affordance before a real Keycloak session exists', () => {
    // Before KeycloakProvider's init() resolves, authenticated is false and
    // authDisabled is false, so the shell shows the "Log in" affordance, not
    // account details — there's no session to show yet.
    render(
      <KeycloakProvider>
        <AppShell />
      </KeycloakProvider>
    );
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
    expect(screen.queryByText(/log out/i)).not.toBeInTheDocument();
  });

  it('shows no account UI in AUTH_DISABLED mode', () => {
    // AUTH_DISABLED mode (VITE_AUTH_DISABLED=true) skips Keycloak entirely —
    // no login screen, no account menu, no Authorization header sent. The
    // shell must render neither a "Log in" button nor signed-in account UI.
    render(
      <KeycloakContext.Provider value={{ initialized: true, authenticated: true, authDisabled: true }}>
        <AppShell />
      </KeycloakContext.Provider>
    );
    expect(screen.queryByRole('button', { name: /log in/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/log out/i)).not.toBeInTheDocument();
  });
});
